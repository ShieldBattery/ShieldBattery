let keyMirror = require('keymirror')

// Every possible dispatched action in the app should be included here, sorted alphabetically
let actions = keyMirror({
  AUTH_LOG_IN: 0,
  AUTH_LOG_IN_FAILURE: 0,
  AUTH_LOG_IN_SUCCESS: 0,
  AUTH_LOGGED_OUT: 0,
})

module.exports = actions
