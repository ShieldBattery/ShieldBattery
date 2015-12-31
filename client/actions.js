// Every possible dispatched action in the app should be included here, sorted semi-alphabetically
export const AUTH_CHANGE_BEGIN = 'AUTH_CHANGE_BEGIN'
export const AUTH_LOG_IN = 'AUTH_LOG_IN'
export const AUTH_LOG_OUT = 'AUTH_LOG_OUT'
export const AUTH_SIGN_UP = 'AUTH_SIGN_UP'

export const DIALOG_OPEN = 'DIALOG_OPEN'
export const DIALOG_CLOSE = 'DIALOG_CLOSE'

// We are starting the process to create a lobby
export const LOBBY_CREATE_BEGIN = 'LOBBY_CREATE_BEGIN'
// The server has responded with success/failure to our lobby creation
export const LOBBY_CREATE = 'LOBBY_CREATE'
// We are now in a lobby, this is the full lobby descriptor
export const LOBBY_INIT_DATA = 'LOBBY_INIT_DATA'
// We are starting the process to join a lobby
export const LOBBY_JOIN_BEGIN = 'LOBBY_JOIN_BEGIN'
// The server has responded with success/failure to our lobby joining
export const LOBBY_JOIN = 'LOBBY_JOIN'
// A lobby we're in now has a new host player
export const LOBBY_UPDATE_HOST_CHANGE = 'LOBBY_UPDATE_HOST_CHANGE'
// A user has joined a lobby we're in
export const LOBBY_UPDATE_JOIN = 'LOBBY_UPDATE_JOIN'
// A user has left a lobby we're in
export const LOBBY_UPDATE_LEAVE = 'LOBBY_UPDATE_LEAVE'

export const SERVER_STATUS = 'SERVER_STATUS'
