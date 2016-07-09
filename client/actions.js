// Every possible dispatched action in the app should be included here, sorted semi-alphabetically
export const ACTIVITY_OVERLAY_OPEN = 'ACTIVITY_OVERLAY_OPEN'
export const ACTIVITY_OVERLAY_CLOSE = 'ACTIVITY_OVERLAY_CLOSE'

export const ADMIN_GET_INVITES_BEGIN = 'ADMIN_GET_INVITES_BEGIN'
export const ADMIN_GET_INVITES = 'ADMIN_GET_INVITES'
export const ADMIN_GET_PERMISSIONS_BEGIN = 'ADMIN_GET_PERMISSIONS_BEGIN'
export const ADMIN_GET_PERMISSIONS = 'ADMIN_GET_PERMISSIONS'
export const ADMIN_ACCEPT_USER_BEGIN = 'ADMIN_ACCEPT_USER_BEGIN'
export const ADMIN_ACCEPT_USER = 'ADMIN_ACCEPT_USER'
export const ADMIN_SET_PERMISSIONS_BEGIN = 'ADMIN_SET_PERMISSIONS_BEGIN'
export const ADMIN_SET_PERMISSIONS = 'ADMIN_SET_PERMISSIONS'

export const AUTH_CHANGE_BEGIN = 'AUTH_CHANGE_BEGIN'
export const AUTH_LOG_IN = 'AUTH_LOG_IN'
export const AUTH_LOG_OUT = 'AUTH_LOG_OUT'
export const AUTH_SIGN_UP = 'AUTH_SIGN_UP'

export const BETA_CREATE_INVITE_BEGIN = 'BETA_CREATE_INVITE_BEGIN'
export const BETA_CREATE_INVITE = 'BETA_CREATE_INVITE'

// Notifies that a user has brought a channel into a visible state (and things like last read
// message should be updated)
export const CHAT_CHANNEL_ACTIVATE = 'CHAT_CHANNEL_ACTIVATE'
// Notifies that a chat channel is no longer visible to the user, and can be cleaned up as
// appropriate (trimming its messsage list to a minimal amount, for instance)
export const CHAT_CHANNEL_DEACTIVATE = 'CHAT_CHANNEL_DEACTIVATE'
// A chat channel that we're in has some initial data we should use to initialize it in the store
export const CHAT_INIT_CHANNEL = 'CHAT_INIT_CHANNEL'
// The server has finished giving us our initial chat data (e.g what channels we are in) on connect
export const CHAT_LOADING_COMPLETE = 'CHAT_LOADING_COMPLETE'
// We're requesting some older chat messages from a channel
export const CHAT_LOAD_CHANNEL_HISTORY_BEGIN = 'CHAT_LOAD_CHANNEL_HISTORY_BEGIN'
// The server has responded to our request for older chat messages (with message, or an error)
export const CHAT_LOAD_CHANNEL_HISTORY = 'CHAT_LOAD_CHANNEL_HISTORY'
// We're requesting the full user list for a channel
export const CHAT_LOAD_USER_LIST_BEGIN = 'CHAT_LOAD_USER_LIST_BEGIN'
// The server has responded to our request for the full user list
export const CHAT_LOAD_USER_LIST = 'CHAT_LOAD_USER_LIST'
export const CHAT_SEND_MESSAGE_BEGIN = 'CHAT_SEND_MESSAGE_BEGIN'
export const CHAT_SEND_MESSAGE = 'CHAT_SEND_MESSAGE'
// We've received a message from a user in one of our joined channels
export const CHAT_UPDATE_MESSAGE = 'CHAT_UPDATE_MESSAGE'
// A user in one of our chat channels has become active (non-idle and online)
export const CHAT_UPDATE_USER_ACTIVE = 'CHAT_UPDATE_USER_ACTIVE'
// A user in one of our chat channels has become idle (still online, but not active)
export const CHAT_UPDATE_USER_IDLE = 'CHAT_UPDATE_USER_IDLE'
// A user in one of our chat channels has gone offline
export const CHAT_UPDATE_USER_OFFLINE = 'CHAT_UPDATE_USER_OFFLINE'

// A user has entered a valid command with the wrong arguments
export const COMMAND_INVALID_ARGS = 'COMMAND_INVALID_ARGS'
// A user has entered an unknown command
export const COMMAND_UNKNOWN = 'COMMAND_UNKNOWN'

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
// An updated StarCraft path validity status, stating whether or not the current path setting
// contains an accessible starcraft.exe
export const PSI_STARCRAFT_PATH_VALIDITY = 'PSI_STARCRAFT_PATH_VALIDITY'
// An updated StarCraft version validity status, stating whether or not the StarCraft exe at the
// current path is a version we are compatible with
export const PSI_STARCRAFT_VERSION_VALIDITY = 'PSI_STARCRAFT_VERSION_VALIDITY'
// The version of the local psi server has been returned
export const PSI_VERSION = 'PSI_VERSION'

// We are starting the process of getting the resolution
export const RESOLUTION_GET_BEGIN = 'RESOLUTION_GET_BEGIN'
// The server has responded with success/failure to our resolution getting
export const RESOLUTION_GET = 'RESOLUTION_GET'

export const SERVER_STATUS = 'SERVER_STATUS'

export const SNACKBAR_OPEN = 'SNACKBAR_OPEN'
export const SNACKBAR_CLOSE = 'SNACKBAR_CLOSE'

// The server has finished subscribing us to the things we need to be (e.g. lobbies) and giving us
// initial data
export const SUBSCRIPTIONS_LOADING_COMPLETE = 'SUBSCRIPTIONS_LOADING_COMPLETE'

// We got new info about the minimum Psi version allowed on this server, along with things like an
// installer URL for the latest version
export const UPGRADE_PSI_INFO = 'UPGRADE_PSI_INFO'

// We are starting the process of closing a whisper session (read comment for
// WHISPERS_START_SESSION_BEGIN action to see what a 'session' represents) with a particular user.
// Ie., pressing an 'x' in the whispers nav entry next to the user's name
export const WHISPERS_CLOSE_SESSION_BEGIN = 'WHISPERS_CLOSE_SESSION_BEGIN'
// The server has responded with success/failure of our closing the whisper session
export const WHISPERS_CLOSE_SESSION = 'WHISPERS_CLOSE_SESSION'
// The server has finished giving us our initial whispers data (eg. the list of users we had the
// whisper window opened with when we last used the site) upon connecting
export const WHISPERS_LOADING_COMPLETE = 'WHISPERS_LOADING_COMPLETE'
// We are starting the process of loading some older whisper messages with a particular user
export const WHISPERS_LOAD_SESSION_HISTORY_BEGIN = 'WHISPERS_LOAD_SESSION_HISTORY_BEGIN'
// The server has responded with success/failure to our request of loading some older whisper
// messages (with message, or an error)
export const WHISPERS_LOAD_SESSION_HISTORY = 'WHISPERS_LOAD_SESSION_HISTORY'
// We are starting the process of sending a whisper message to another user
export const WHISPERS_SEND_MESSAGE_BEGIN = 'WHISPERS_SEND_MESSAGE_BEGIN'
// The server has responded with success/failure of our whisper message sending
export const WHISPERS_SEND_MESSAGE = 'WHISPERS_SEND_MESSAGE'
// We are starting the process of initiating a whisper session with another user. Whisper session
// represents a dedicated window where messages between us and another user are displayed. It's
// impossible to send a whisper message to another user without having a session opened with them
// first. The session can either be opened manually, by clicking a button in the LeftNav and
// entering a user's name, or by sending a whisper message using chat commands in any of our
// chat-related components, in which case a session with that user will be opened automatically
// prior to sending a message
export const WHISPERS_START_SESSION_BEGIN = 'WHISPERS_START_SESSION_BEGIN'
// The server has responded with success/failure of our initiation of whisper session
export const WHISPERS_START_SESSION = 'WHISPERS_START_SESSION'
// We have closed a whisper session with a particular user
export const WHISPERS_UPDATE_CLOSE_SESSION = 'WHISPERS_UPDATE_CLOSE_SESSION'
// We have started a new whisper session with a particular user
export const WHISPERS_UPDATE_INIT_SESSION = 'WHISPERS_UPDATE_INIT_SESSION'
// We have received a message from a user in one of our whisper sessions
export const WHISPERS_UPDATE_MESSAGE = 'WHISPERS_UPDATE_MESSAGE'
// A user in one of our whisper sessions has become active (non-idle and online)
export const WHISPERS_UPDATE_USER_ACTIVE = 'WHISPERS_UPDATE_USER_ACTIVE'
// A user in one of our whisper sessions has become idle (still online, but not active)
export const WHISPERS_UPDATE_USER_IDLE = 'WHISPERS_UPDATE_USER_IDLE'
// A user in one of our whisper sessions has gone offline
export const WHISPERS_UPDATE_USER_OFFLINE = 'WHISPERS_UPDATE_USER_OFFLINE'
