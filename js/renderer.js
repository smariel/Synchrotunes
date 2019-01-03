// Framworks and libraries
window.$ = window.jQuery = require('jquery');
const fs                 = require('fs');
const xml2js             = require('xml2js');
require('../node_modules/bootstrap/dist/js/bootstrap.bundle.min.js');

// return the data from the iTunes Music Library XML
function get_iTunesLibData(iTunesLibPath) {
  return new Promise(resolve => {
    fs.readFile(iTunesLibPath, function(err, data) {
      let parser = new xml2js.Parser();
      parser.parseString(data, function (err, result) {
        resolve(result);
      });
    });
  });
}

// return all playlists names and paths to the tracks
function get_iTunesPlaylists(iTunesLib) {
  // get the path of all tracks
  let tracks = [];
  for(let trackData of iTunesLib.plist.dict[0].dict[0].dict) {
    tracks[trackData.integer[0]] = trackData.string[trackData.string.length - 1];
  }

  // parse all playlists data
  let playlists = [];
  for(let playlistData of iTunesLib.plist.dict[0].array[0].dict) {
    // if the playlist is empty, continue
    if(undefined === playlistData.array || playlistData.array.length < 1) continue;

    // for each track in the playlist
    let playlistTracks = [];
    for(let trackData of playlistData.array[0].dict) {
      // get the path of the track
      let trackID = trackData.integer[0];
      playlistTracks.push(tracks[trackID]);
    }

    // push the data of this playlist to the array
    playlists.push({
      name   : playlistData.string[playlistData.string.length - 1],
      tracks : playlistTracks,
    });
  }

  return playlists;
}

// When jQuery is ready
$(() => {
  // init app data
  let iTunesPlaylists = [];
  let iTunesLibPath   = `${process.env.HOME}/Music/iTunes/iTunes Music Library.xml`;
  let targetPath      = `${process.env.HOME}/Desktop`;

  // init HTML
  $('#loading-screen').hide();
  $('#iTunesLibPath' ).val(iTunesLibPath);
  $('#targetPath'    ).val(targetPath);

  // EVENT: click to choose a path
  $('.choose-path').click((evt) => {
    // get the subject
    let subject = $(evt.target).data('subject');

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
        properties  : ['openDirectory']
      };
    }

    // open the dialog
    const { dialog } = require('electron').remote;
    let path = dialog.showOpenDialog(dialog_options);

    // if the dialog was not canceled
    if(path !== undefined) {
      // copy the path to the input value
      $(`#${subject}`).val(path[0]);
    }
  });


  // EVENT: click on the "load" button
  $('#bt-load').click(async () => {
    // check paths
    $('#iTunesLibPath').removeClass('text-danger').removeClass('border-danger');
    $('#targetPath'   ).removeClass('text-danger').removeClass('border-danger');
    let iTunesLibPath = $('#iTunesLibPath').val();
    if (!fs.existsSync(iTunesLibPath)) {
      $('#iTunesLibPath').addClass('text-danger').addClass('border-danger');
      return;
    }
    if (!fs.existsSync($('#targetPath').val())) {
      $('#targetPath').addClass('text-danger').addClass('border-danger');
      return;
    }

    // show a loading screen and prepare the next layout
    $('#loading-screen'  ).show();
    $('#section-init'    ).hide();
    $('#section-playlist').show();

    // get all the playlists from the iTunes Music Library
    let iTunesLib = await get_iTunesLibData(iTunesLibPath);
    iTunesPlaylists = get_iTunesPlaylists(iTunesLib);

    // fill the form with the playlists names
    for(let i=0; i<iTunesPlaylists.length; i++) {
      $('#iTunesPlaylists').append(`<option value="${i}">${iTunesPlaylists[i].name}</option>`);
    }

    // hide the loading screen
    $('#loading-screen').hide();

  });


  // EVENT: analyse button clicked
  $('#bt-analyze').click(() => {
    // get the playlists to sync
    let selected = $('#iTunesPlaylists option:selected');
    let playlistsToSync = [];
    // for each playlist
    for(let sel of selected) {
      // keep a reference to this playlist somewhere
      let playlist = iTunesPlaylists[$(sel).val()];
      playlistsToSync.push(playlist);

      // init the work to do
      playlist.todo = {
        dir      : `${targetPath}/${playlist.name}`,
        dirExist : false,
        newTracks: [],
        delTracks: []
      };

      // if a folder already exist for this playlist
      if (fs.existsSync(playlist.todo.dir)) {
        playlist.todo.dirExist = true;

        // get the content of the target folder
        let dirFiles = fs.readdirSync(playlist.todo.dir);

        // if the folder is empty
        if(0 == dirFiles.length) {
          // set all the tracks to be copied
          playlist.todo.newTracks = playlist.tracks;
        }
        else {
          // check if the file has to be deleted
          for(let files of dirFiles) {
            // TODO
          }

          // check which file to copy {
          for(let trackPath of playlist.tracks) {
            // TODO
          }
        }
        }
      }
      else {
        // set all the tracks to be copied
        playlist.todo.newTracks = playlist.tracks;
      }

    }

  });


  // EVENT: back button clicked
  $('#bt-backToInit').click(() => {
    $('#section-playlist').hide();
    $('#section-init').show();
  });

  // EVENT: back button clicked
  $('#bt-backToPlaylists').click(() => {
    $('#section-analyze').hide();
    $('#section-playlist').show();
  });



});
