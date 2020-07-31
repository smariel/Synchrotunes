// Framworks and libraries
window.$ = window.jQuery = require('jquery');
const fs                 = require('fs');
const fsPromises         = require('fs').promises;
const path               = require('path');
const xml2js             = require('xml2js');
const util               = require('util');
const exec               = util.promisify(require('child_process').exec);
require('../node_modules/bootstrap/dist/js/bootstrap.bundle.min.js');

// init global app data
let appData = {
  iTunesPlaylists : [],
  iTunesLibPath   : `${process.env.HOME}/Music/iTunes/iTunes Music Library.xml`,
  targetPath      : `${process.env.HOME}/Desktop`,
  playlistsToSync : [],
  convert         : false,
  operations      : {
    newTracks: 0,
    delFiles : 0,
    delDirs  : 0,
    total    : 0
  }
};


// set a path to the subject
function setPath(subject) {
  // init the dialog options according to the subject
  let dialog_options = {};
  if('iTunesLibPath' == subject) {
    dialog_options = {
      defaultPath : $('#iTunesLibPath').val(),
      filters     : [{name: 'XML', extensions: ['xml']}],
      properties  : ['openFile']
    };
  }
  else if ('targetPath' == subject) {
    dialog_options = {
      defaultPath : $('#targetPath').val(),
      properties  : ['openDirectory', 'createDirectory']
    };
  }

  // open the dialog
  const { dialog } = require('electron').remote;
  let path = dialog.showOpenDialog(dialog_options);

  // if the dialog was not canceled
  if(path !== undefined) {
    // copy the path to the input value
    $(`#${subject}`).val(path[0]).removeClass('text-danger').removeClass('border-danger');
  }
}


// check the given paths and load the iTunes playlists
async function load() {
  const url = require('url');

  // prepare a function returning a promise with the data from the iTunes Music Library XML
  let get_iTunesLibData = (iTunesLibPath) => {
    return new Promise(resolve => {
      fs.readFile(iTunesLibPath, function(err, data) {
        let parser = new xml2js.Parser();
        parser.parseString(data, function (err, result) {
          resolve(result);
        });
      });
    });
  };

  // get the iTunes Music Library as a JS object
  let iTunesLib = await get_iTunesLibData(appData.iTunesLibPath);

  // get the path of all tracks
  // or get 'null' if the track is not a file
  let tracks = [];
  for(let trackData of iTunesLib.plist.dict[0].dict[0].dict) {
    tracks[trackData.integer[0]] = ('File' === trackData.string[1]) ? trackData.string[trackData.string.length - 1] : null;
  }

  // parse all playlists data
  appData.iTunesPlaylists = [];
  for(let playlistData of iTunesLib.plist.dict[0].array[0].dict) {
    // if the playlist is empty, continue
    if(undefined === playlistData.array || playlistData.array.length < 1) continue;

    // for each track in the playlist
    let playlistTracks = [];
    for(let trackData of playlistData.array[0].dict) {
      // get the path of the track that are files (!== null)
      let trackID = trackData.integer[0];
      let trackDirtyPath = tracks[trackID];
      if(null !== trackDirtyPath) {
        let trackPath;
        try {
          trackPath = url.fileURLToPath(tracks[trackID]);
        }
        catch (err) {
          console.error(err);
          continue;
        }
        playlistTracks.push(trackPath);
      }
    }

    // push the data of this playlist to the array
    appData.iTunesPlaylists.push({
      name   : playlistData.string[playlistData.string.length - 1],
      tracks : playlistTracks,
    });
  }
}


// analyze the selected playlists
async function analyze(selectedPlaylists) {
  // init
  appData.playlistsToSync = [];

  // for each playlist
  for(let sel of selectedPlaylists) {
    // keep a reference to this playlist somewhere
    let playlist = appData.iTunesPlaylists[$(sel).val()];
    appData.playlistsToSync.push(playlist);

    // init the work to do
    playlist.todo = {
      dir      : `${appData.targetPath}/${playlist.name}`,
      dirExist : false,
      newTracks: [],
      delFiles : [],
      delDirs  : [],
    };

    // if a folder already exist for this playlist
    if (fs.existsSync(playlist.todo.dir)) {
      playlist.todo.dirExist = true;

      // get the content of the target folder
      let dirContent = await fsPromises.readdir(playlist.todo.dir);

      // if the folder is empty
      if(0 == dirContent.length) {
        // set all the tracks to be copied
        playlist.todo.newTracks = playlist.tracks;
      }
      else {
        // STEP1/2 : check files or dir to delete
        // for each content of the directory
        for(let contentName of dirContent) {
          // get stats on the content
          let contentPath = `${playlist.todo.dir}/${contentName}`;
          let contentStat = await fsPromises.stat(contentPath);
          // if the content is a directory
          if(contentStat.isDirectory()) {
            // set the dir to be deleted
            playlist.todo.delDirs.push(contentPath);
          }
          // else if the content is a file
          else {
            // for each track of the playlist
            let trackExist = false;
            for(let trackPath of playlist.tracks) {
              let trackName = (appData.convert) ? path.basename(trackPath).replace(/\.[A-Za-z0-9]{2,4}$/, '.mp3') : path.basename(trackPath);
              // if the track is already in the dir
              if(trackName == contentName) {
                // TODO: manage dates
                trackExist = true;
                break;
              }
            }

            // if the content is not a track of the playlist
            if(!trackExist) {
              // mark as deleted
              playlist.todo.delFiles.push(contentPath);
            }
          }
        }

        // STEP2/2 : check tracks to add
        // for each track of the playlist
        for(let trackPath of playlist.tracks) {
          let trackName = (appData.convert) ? path.basename(trackPath).replace(/\.[A-Za-z0-9]{2,4}$/, '.mp3') : path.basename(trackPath);
          let trackExist = false;
          // for each content of the directory
          for(let contentName of dirContent) {
            // if the track is already in the dir (ignore extension)
            if(trackName == contentName) {
              // dates are managed in the step 1
              // ignore this track
              trackExist = true;
              break;
            }
          }

          // if the track is not in the directory
          if(!trackExist) {
            // mark as to be added
            playlist.todo.newTracks.push(trackPath);
          }
        }
      }
    }
    else {
      // set all the tracks to be copied
      playlist.todo.newTracks = playlist.tracks;
    }

    appData.operations.newTracks += playlist.todo.newTracks.length;
    appData.operations.delDirs   += playlist.todo.delDirs.length;
    appData.operations.delFiles  += playlist.todo.delFiles.length;
    appData.operations.total     += appData.operations.newTracks + appData.operations.delDirs + appData.operations.delFiles;
  }
}


// sync files according to the analyze
async function sync() {
  let t_start = performance.now();

  const del = require('del');

  // init
  let errors = [];

  // for each playlist to sync
  let i=0;
  $('#loading-progress').attr('max',appData.operations.total);
  for(let playlist of appData.playlistsToSync) {
    // if the directory does not exist, create it
    if(!playlist.todo.dirExist) {
      await fsPromises.mkdir(playlist.todo.dir).catch(err => {
        errors.push(err);
      });
    }

    // for each file do telete
    for(let delFile of playlist.todo.delFiles) {
      $('#loading-progress').attr('value',++i);
      await fsPromises.unlink(delFile).catch(err => {
        errors.push(err);
      });
    }

    // for each directory do telete
    for(let delDir of playlist.todo.delDirs) {
      $('#loading-progress').attr('value',++i);
      await del(delDir, {force: true}).catch(err => {
        errors.push(err);
      });
    }

    // for each track to add
    for(let sourcePath of playlist.todo.newTracks) {
      $('#loading-progress').attr('value',++i);
      let destPath = `${playlist.todo.dir}/${path.basename(sourcePath)}`;


      // if the file has to be converted and is not an mp3
      if(appData.convert && !/\.mp3$/.test(sourcePath)) {
        // convert to mp3
        try {
          await exec(`ffmpeg -i "${sourcePath}" -y -vn -b:a 192k "${destPath.replace(/\.[a-zA-Z0-9]{2,4}$/, '.mp3')}"`);
        }
        catch(e) {
          console.error(e);
        }
      }
      else {
        // copy the file to the destination
        await fsPromises.copyFile(sourcePath, destPath).catch(err => {
          errors.push(err);
        });
      }
    }
  }

  let t_end = performance.now();
  let sync_time = (t_end - t_start)/1000;
  console.info(`Sync time: ${sync_time}s`); // eslint-disable-line no-console

  return errors;
}


// When jQuery is ready
$(() => {
  // init HTML
  $('#loading-screen').hide();
  $('#iTunesLibPath' ).val(appData.iTunesLibPath);
  $('#targetPath'    ).val(appData.targetPath);

  // click to choose a path
  $('.choose-path').click((evt) => {
    setPath($(evt.target).data('subject'));
  });

  // STEP1: load the iTunes lib
  $('#bt-load').click(() => {
    // check the path to the iTunes lib
    $('#iTunesLibPath').removeClass('text-danger').removeClass('border-danger');
    appData.iTunesLibPath = $('#iTunesLibPath').val();
    if (!fs.existsSync(appData.iTunesLibPath)) {
      $('#iTunesLibPath').addClass('text-danger').addClass('border-danger');
      return;
    }

    // show a loading screen and prepare the next layout
    $('#loading-title').text('Loading iTunes Library');
    $('#loading-screen'  ).show();
    $('#section-init'    ).hide();
    $('#section-playlist').show();

    // asynchronously load the iTunes lib, then...
    load().then(() => {
      // fill the form with the playlists names
      $('#iTunesPlaylists').empty();
      for(let i=0; i<appData.iTunesPlaylists.length; i++) {
        $('#iTunesPlaylists').append(`<option value="${i}">${appData.iTunesPlaylists[i].name}</option>`);
      }

      // hide the loading screen
      $('#loading-screen').hide();
    });
  });

  // STEP2: analyse the sync
  $('#bt-analyze').click(() => {
    // check if files have to be converted
    appData.convert = $('#convert').prop('checked');

    // check the path to the target
    $('#targetPath').removeClass('text-danger').removeClass('border-danger');
    appData.targetPath = $('#targetPath').val();
    if (!fs.existsSync(appData.targetPath)) {
      $('#targetPath').addClass('text-danger').addClass('border-danger');
      return;
    }

    // get the playlists to sync
    let selectedPlaylists = $('#iTunesPlaylists option:selected');
    if(selectedPlaylists.length > 0) {
      $('#iTunesPlaylists').removeClass('border-danger');
    }
    else {
      $('#iTunesPlaylists').addClass('border-danger');
      return;
    }

    // show the loading screen and prepare the next section
    $('#loading-title'   ).text('Analyzing');
    $('#loading-screen'  ).show();
    $('#section-playlist').hide();
    $('#section-analyze' ).show();
    $('#analyze-report'  ).empty();

    // synchronously analyze
    analyze(selectedPlaylists).then(() => {
      // for each playlist to sync, display the analyze report
      for(let playlist of appData.playlistsToSync) {
        let analyzeReport = `<h5>${playlist.name}</h5>`;
        analyzeReport += `<h6>Target directory ${(playlist.todo.dirExist)?'(existing)':'(to be created)'}</h6>`;
        analyzeReport += `<ul><li>${playlist.todo.dir}</li></ul>`;
        if(playlist.todo.newTracks.length > 0) {
          analyzeReport += `<h6>${playlist.todo.newTracks.length} new tracks</h6><ul>`;
          for(let newTrack of playlist.todo.newTracks) {
            analyzeReport += `<li>${path.basename(newTrack)}</li>`;
          }
          analyzeReport += '</ul>';
        }
        if(playlist.todo.delFiles.length > 0) {
          analyzeReport += `<h6>${playlist.todo.delFiles.length} files to delete</h6><ul>`;
          for(let delFile of playlist.todo.delFiles) {
            analyzeReport += `<li>${delFile}</li>`;
          }
          analyzeReport += '</ul>';
        }
        if(playlist.todo.delDirs.length > 0) {
          analyzeReport += `<h6>${playlist.todo.delDirs.length} directories to delete</h6><ul>`;
          for(let delDir of playlist.todo.delDirs) {
            analyzeReport += `<li>${delDir}</li>`;
          }
          analyzeReport += '</ul>';
        }
        $('#analyze-report').append(analyzeReport);
      }

      // hide the loading screen
      $('#loading-screen').hide();
    });
  });

  // STEP3: sync
  $('#bt-sync').click(() => {
    // show the loading screen and prepare the next section
    $('#loading-title'   ).text('Sync');
    $('#loading-progress').show();
    $('#loading-screen'  ).show();
    $('#section-analyze' ).hide();
    $('#section-sync'    ).show();

    // sync
    sync().then(errors => {
      // if there was errors, print them
      if(errors.length > 0) {
        $('#sync-report').html('Sync terminated with errors:<br />');
        for(let error of errors) {
          $('#sync-report').append(`${error}<br />`);
        }
      }
      else {
        $('#sync-report').text('Sync done!');
      }

      // hide the loading screen
      $('#loading-screen' ).hide();
    });
  });

  // back button clicked
  $('#bt-backToInit').click(() => {
    $('#section-playlist').hide();
    $('#section-init').show();
  });

  // back button clicked
  $('#bt-backToPlaylists').click(() => {
    $('#section-analyze').hide();
    $('#section-playlist').show();
  });

  // back button clicked
  $('#bt-backToPlaylists2').click(() => {
    $('#section-sync').hide();
    $('#section-playlist').show();
  });

  // restart button clicked
  $('#bt-backToInit2').click(() => {
    $('#section-sync').hide();
    $('#section-init').show();
  });
});
