// Every possible dispatched action in the app should be included here, sorted semi-alphabetically
export const ACTIVITY_OVERLAY_OPEN = 'ACTIVITY_OVERLAY_OPEN'
export const ACTIVITY_OVERLAY_CLOSE = 'ACTIVITY_OVERLAY_CLOSE'

export const AUTH_CHANGE_BEGIN = 'AUTH_CHANGE_BEGIN'
export const AUTH_LOG_IN = 'AUTH_LOG_IN'
export const AUTH_LOG_OUT = 'AUTH_LOG_OUT'
export const AUTH_SIGN_UP = 'AUTH_SIGN_UP'

export const DIALOG_OPEN = 'DIALOG_OPEN'
export const DIALOG_CLOSE = 'DIALOG_CLOSE'

// We are starting the process of getting the state of a particular lobby
export const LOBBIES_GET_STATE_BEGIN = 'LOBBIES_GET_STATE_BEGIN'
// The server has responded with success/failure to our request of lobby state
export const LOBBIES_GET_STATE = 'LOBBIES_GET_STATE'
// The server has sent us an update to the lobby list (used for joining lobbies)
export const LOBBIES_LIST_UPDATE = 'LOBBIES_LIST_UPDATE'

// We are starting the process of adding a computer to a lobby
export const LOBBY_ADD_COMPUTER_BEGIN = 'LOBBY_ADD_COMPUTER_BEGIN'
// The server has responded with success/failure to our addition of computer in lobby
export const LOBBY_ADD_COMPUTER = 'LOBBY_ADD_COMPUTER'
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
// We are starting the process of leaving a lobby
export const LOBBY_LEAVE_BEGIN = 'LOBBY_LEAVE_BEGIN'
// The server has responded with success/failure to our lobby leaving
export const LOBBY_LEAVE = 'LOBBY_LEAVE'
// We are sending a chat message to the server
export const LOBBY_SEND_CHAT_BEGIN = 'LOBBY_SEND_CHAT_BEGIN'
// The server has replied with success/failure to our sent chat message
export const LOBBY_SEND_CHAT = 'LOBBY_SEND_CHAT'
// We are starting the process of setting the race of a player
export const LOBBY_SET_RACE_BEGIN = 'LOBBY_SET_RACE_BEGIN'
// The server has responded with success/failure to our race setting
export const LOBBY_SET_RACE = 'LOBBY_SET_RACE'
// We are sending the request to start the game countdown
export const LOBBY_START_COUNTDOWN_BEGIN = 'LOBBY_START_COUNTDOWN_BEGIN'
// The server has responded with success/failure for starting the game countdown
export const LOBBY_START_COUNTDOWN = 'LOBBY_START_COUNTDOWN'
// A new chat message has been received
export const LOBBY_UPDATE_CHAT_MESSAGE = 'LOBBY_UPDATE_CHAT_MESSAGE'
// The countdown for the lobby we're in has been canceled
export const LOBBY_UPDATE_COUNTDOWN_CANCELED = 'LOBBY_UPDATE_COUNTDOWN_CANCELED'
// A lobby we're in is starting the game countdown
export const LOBBY_UPDATE_COUNTDOWN_START = 'LOBBY_UPDATE_COUNTDOWN_START'
// A second has ticked off the countdown for a lobby we're in
export const LOBBY_UPDATE_COUNTDOWN_TICK = 'LOBBY_UPDATE_COUNTDOWN_TICK'
// The game has been started and this lobby is now complete/closed
export const LOBBY_UPDATE_GAME_STARTED = 'LOBBY_UPDATE_GAME_STARTED'
// A lobby we're in now has a new host player
export const LOBBY_UPDATE_HOST_CHANGE = 'LOBBY_UPDATE_HOST_CHANGE'
// A user has joined a lobby we're in
export const LOBBY_UPDATE_JOIN = 'LOBBY_UPDATE_JOIN'
// A user has left a lobby we're in
export const LOBBY_UPDATE_LEAVE = 'LOBBY_UPDATE_LEAVE'
// We have left a lobby we're in
export const LOBBY_UPDATE_LEAVE_SELF = 'LOBBY_UPDATE_LEAVE_SELF'
// The lobby has entered the game setup phase (and we are loading the game)
export const LOBBY_UPDATE_LOADING_START = 'LOBBY_UPDATE_LOADING_START'
// The lobby has canceled out of the loading phase (because of timeout or load failure)
export const LOBBY_UPDATE_LOADING_CANCELED = 'LOBBY_UPDATE_LOADING_CANCELED'
// A user has changed the race in a lobby we're in
export const LOBBY_UPDATE_RACE_CHANGE = 'LOBBY_UPDATE_RACE_CHANGE'

// We are starting the process of saving the settings
export const LOCAL_SETTINGS_SET_BEGIN = 'LOCAL_SETTINGS_SET_BEGIN'
// The server has responded with success/failure to our settings saving
export const LOCAL_SETTINGS_SET = 'LOCAL_SETTINGS_SET'
// The settings pertaining to this computer only have changed
export const LOCAL_SETTINGS_UPDATE = 'LOCAL_SETTINGS_UPDATE'

// We are beginning to retrieve the list of maps from the server
export const MAPS_LIST_GET_BEGIN = 'MAPS_LIST_GET_BEGIN'
// We have received a respond to our map list retrieval (error or the list of maps)
export const MAPS_LIST_GET = 'MAPS_LIST_GET'

export const NETWORK_PSI_CONNECTED = 'NETWORK_PSI_CONNECTED'
export const NETWORK_PSI_DISCONNECTED = 'NETWORK_PSI_DISCONNECTED'
export const NETWORK_SITE_CONNECTED = 'NETWORK_SITE_CONNECTED'
export const NETWORK_SITE_DISCONNECTED = 'NETWORK_SITE_DISCONNECTED'

// The success/failure of launching a game with psi
export const PSI_GAME_LAUNCH = 'PSI_GAME_LAUNCH'
// An updated status (e.g. "launching", "configuring") for a particular local game client
export const PSI_GAME_STATUS = 'PSI_GAME_STATUS'

// We are starting the process of getting the resolution
export const RESOLUTION_GET_BEGIN = 'RESOLUTION_GET_BEGIN'
// The server has responded with success/failure to our resolution getting
export const RESOLUTION_GET = 'RESOLUTION_GET'

export const SERVER_STATUS = 'SERVER_STATUS'

export const SNACKBAR_OPEN = 'SNACKBAR_OPEN'
export const SNACKBAR_CLOSE = 'SNACKBAR_CLOSE'
