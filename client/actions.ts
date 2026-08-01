// Every possible dispatched action in the app should be included here, sorted semi-alphabetically

// The AudioManager has finished initializing and is ready to play sounds
export const AUDIO_MANAGER_INITIALIZED = 'AUDIO_MANAGER_INITIALIZED'

// The server has sent us an updated count on the number of active lobbies
export const LOBBIES_COUNT_UPDATE = 'LOBBIES_COUNT_UPDATE'

// We are starting the process of getting the state of a particular lobby
export const LOBBIES_GET_STATE_BEGIN = 'LOBBIES_GET_STATE_BEGIN'
// The server has responded with success/failure to our request of lobby state
export const LOBBIES_GET_STATE = 'LOBBIES_GET_STATE'
// The server has sent us an update to the lobby list (used for joining lobbies)
export const LOBBIES_LIST_UPDATE = 'LOBBIES_LIST_UPDATE'

// Notifies that a user has brought a lobby into a visible state (and things like last read
// message should be updated)
export const LOBBY_ACTIVATE = 'LOBBY_ACTIVATE'
// Notifies that a lobby is no longer visible to the user, and can be cleaned up as
// appropriate (trimming its messsage list to a minimal amount, for instance)
export const LOBBY_DEACTIVATE = 'LOBBY_DEACTIVATE'
// We are now in a lobby, this is the full lobby descriptor
export const LOBBY_INIT_DATA = 'LOBBY_INIT_DATA'
// A user has been banned in a lobby we're in
export const LOBBY_UPDATE_BAN = 'LOBBY_UPDATE_BAN'
// We have been banned from a lobby
export const LOBBY_UPDATE_BAN_SELF = 'LOBBY_UPDATE_BAN_SELF'
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
// A user has been kicked in a lobby we're in
export const LOBBY_UPDATE_KICK = 'LOBBY_UPDATE_KICK'
// We have been kicked from a lobby
export const LOBBY_UPDATE_KICK_SELF = 'LOBBY_UPDATE_KICK_SELF'
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
// A user has moved slots in a lobby we're in
export const LOBBY_UPDATE_SLOT_CHANGE = 'LOBBY_UPDATE_SLOT_CHANGE'
// A new slot has been created in a lobby we're in (this could indicate player joining)
export const LOBBY_UPDATE_SLOT_CREATE = 'LOBBY_UPDATE_SLOT_CREATE'
// Our status has changed, ie. one of our clients either joined or left the lobby
export const LOBBY_UPDATE_STATUS = 'LOBBY_UPDATE_STATUS'

// We are beginning to retrieve the lobby preferences from the server
export const LOBBY_PREFERENCES_GET_BEGIN = 'LOBBY_PREFERENCES_GET_BEGIN'
// The server has responded with success/failure to our retrieval of lobby preferences
export const LOBBY_PREFERENCES_GET = 'LOBBY_PREFERENCES_GET'
// We are beginning to update the lobby preferences to the server
export const LOBBY_PREFERENCES_UPDATE_BEGIN = 'LOBBY_PREFERENCES_UPDATE_BEGIN'
// The server has responded with success/failure to us updating the lobby preferences
export const LOBBY_PREFERENCES_UPDATE = 'LOBBY_PREFERENCES_UPDATE'
