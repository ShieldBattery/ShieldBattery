import keyMirror from 'keymirror'

// Every possible dispatched action in the app should be included here, sorted alphabetically
const actions = keyMirror({
  AUTH_CHANGE_BEGIN: 0,
  AUTH_LOG_IN: 0,
  AUTH_LOG_OUT: 0,
  AUTH_SIGN_UP: 0,
  REGISTER_FOR_SERVER_STATUS: 0,
  UNREGISTER_FOR_SERVER_STATUS: 0,
  SERVER_STATUS: 0,
})

export default actions
