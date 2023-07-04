// Every possible dispatched action in the app should be included here, sorted semi-alphabetically

export const ADMIN_MAP_POOL_CLEAR_SEARCH = 'ADMIN_MAP_POOL_CLEAR_SEARCH'
export const ADMIN_MAP_POOL_CREATE_BEGIN = 'ADMIN_MAP_POOL_CREATE_BEGIN'
export const ADMIN_MAP_POOL_CREATE = 'ADMIN_MAP_POOL_CREATE'
export const ADMIN_MAP_POOL_DELETE_BEGIN = 'ADMIN_MAP_POOL_DELETE_BEGIN'
export const ADMIN_MAP_POOL_DELETE = 'ADMIN_MAP_POOL_DELETE'
export const ADMIN_MAP_POOL_GET_HISTORY_BEGIN = 'ADMIN_MAP_POOL_GET_HISTORY_BEGIN'
export const ADMIN_MAP_POOL_GET_HISTORY = 'ADMIN_MAP_POOL_GET_HISTORY'
export const ADMIN_MAP_POOL_SEARCH_MAPS_BEGIN = 'ADMIN_MAP_POOL_SEARCH_MAPS_BEGIN'
export const ADMIN_MAP_POOL_SEARCH_MAPS = 'ADMIN_MAP_POOL_SEARCH_MAPS'
export const ADMIN_MATCHMAKING_TIMES_ADD_BEGIN = 'ADMIN_MATCHMAKING_TIMES_ADD_BEGIN'
export const ADMIN_MATCHMAKING_TIMES_ADD = 'ADMIN_MATCHMAKING_TIMES_ADD'
export const ADMIN_MATCHMAKING_TIMES_DELETE_BEGIN = 'ADMIN_MATCHMAKING_TIMES_DELETE_BEGIN'
export const ADMIN_MATCHMAKING_TIMES_DELETE = 'ADMIN_MATCHMAKING_TIMES_DELETE'
export const ADMIN_MATCHMAKING_TIMES_GET_HISTORY_BEGIN = 'ADMIN_MATCHMAKING_TIMES_GET_HISTORY_BEGIN'
export const ADMIN_MATCHMAKING_TIMES_GET_HISTORY = 'ADMIN_MATCHMAKING_TIMES_GET_HISTORY'
export const ADMIN_MATCHMAKING_TIMES_GET_FUTURE_BEGIN = 'ADMIN_MATCHMAKING_TIMES_GET_FUTURE_BEGIN'
export const ADMIN_MATCHMAKING_TIMES_GET_FUTURE = 'ADMIN_MATCHMAKING_TIMES_GET_FUTURE'
export const ADMIN_MATCHMAKING_TIMES_GET_PAST_BEGIN = 'ADMIN_MATCHMAKING_TIMES_GET_PAST_BEGIN'
export const ADMIN_MATCHMAKING_TIMES_GET_PAST = 'ADMIN_MATCHMAKING_TIMES_GET_PAST'

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
// We are starting the process of adding a computer to a lobby
export const LOBBY_ADD_COMPUTER_BEGIN = 'LOBBY_ADD_COMPUTER_BEGIN'
// The server has responded with success/failure to our addition of computer in lobby
export const LOBBY_ADD_COMPUTER = 'LOBBY_ADD_COMPUTER'
// We are starting the process of banning a player from a lobby
export const LOBBY_BAN_PLAYER_BEGIN = 'LOBBY_BAN_PLAYER_BEGIN'
// The server has responded with success/failure to our banning of a player in lobby
export const LOBBY_BAN_PLAYER = 'LOBBY_BAN_PLAYER'
// We are starting the process of moving from one slot to another in a lobby
export const LOBBY_CHANGE_SLOT_BEGIN = 'LOBBY_CHANGE_SLOT_BEGIN'
// The server has responded with success/rejection to us attempting to switch lobby slots
export const LOBBY_CHANGE_SLOT = 'LOBBY_CHANGE_SLOT'
// We are starting the process of closing a lobby slot
export const LOBBY_CLOSE_SLOT_BEGIN = 'LOBBY_CLOSE_SLOT_BEGIN'
// The server has responded with success/failure to our closing of a lobby slot
export const LOBBY_CLOSE_SLOT = 'LOBBY_CLOSE_SLOT'
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
// We are starting the process of kicking a player from a lobby
export const LOBBY_KICK_PLAYER_BEGIN = 'LOBBY_KICK_PLAYER_BEGIN'
// The server has responded with success/failure to our kicking a player in lobby
export const LOBBY_KICK_PLAYER = 'LOBBY_KICK_PLAYER'
// We are starting the process of leaving a lobby
export const LOBBY_LEAVE_BEGIN = 'LOBBY_LEAVE_BEGIN'
// The server has responded with success/failure to our lobby leaving
export const LOBBY_LEAVE = 'LOBBY_LEAVE'
// We are starting a request to add an additional slot to the observer team
export const LOBBY_MAKE_OBSERVER_BEGIN = 'LOBBY_MAKE_OBSERVER_BEGIN'
// The server has responded with success/failure to obs team extension
export const LOBBY_MAKE_OBSERVER = 'LOBBY_MAKE_OBSERVER'
// We are starting the process of opening a lobby slot
export const LOBBY_OPEN_SLOT_BEGIN = 'LOBBY_OPEN_SLOT_BEGIN'
// The server has responded with success/failure to our opening of a lobby slot
export const LOBBY_OPEN_SLOT = 'LOBBY_OPEN_SLOT'
// We are starting a request to remove a slot from the observer team
export const LOBBY_REMOVE_OBSERVER_BEGIN = 'LOBBY_REMOVE_OBSERVER_BEGIN'
// The server has responded with success/failure to our request of removing an obs slot
export const LOBBY_REMOVE_OBSERVER = 'LOBBY_REMOVE_OBSERVER'
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
// One of teams in a lobby has had a slot deleted (due to creating/removing obs slots)
export const LOBBY_UPDATE_SLOT_DELETED = 'LOBBY_UPDATE_SLOT_DELETED'
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

// We have started the process of launching the game with the selected replay in it
export const REPLAYS_START_REPLAY = 'REPLAYS_START_REPLAY'

export const SERVER_STATUS = 'SERVER_STATUS'

export const SNACKBAR_OPEN = 'SNACKBAR_OPEN'
export const SNACKBAR_CLOSE = 'SNACKBAR_CLOSE'

// An updated validity status for each important ShieldBattery file, indicating whether they are
// accessible and have the correct contents.
export const SHIELDBATTERY_FILES_VALIDITY = 'SHIELDBATTERY_FILES_VALIDITY'

// An updated StarCraft path validity status, stating whether or not the current path setting
// contains an accessible starcraft.exe
export const STARCRAFT_PATH_VALIDITY = 'STARCRAFT_PATH_VALIDITY'
// An updated StarCraft version validity status, stating whether or not the StarCraft exe at the
// current path is a version we are compatible with
export const STARCRAFT_VERSION_VALIDITY = 'STARCRAFT_VERSION_VALIDITY'
