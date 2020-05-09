// Every possible dispatched action in the app should be included here, sorted semi-alphabetically

// A new StarCraft game has launched
export const ACTIVE_GAME_LAUNCH = 'ACTIVE_GAME_LAUNCH'
// The status for a currently running StarCraft game has been updated
export const ACTIVE_GAME_STATUS = 'ACTIVE_GAME_STATUS'

export const ACTIVITY_OVERLAY_OPEN = 'ACTIVITY_OVERLAY_OPEN'
export const ACTIVITY_OVERLAY_CLOSE = 'ACTIVITY_OVERLAY_CLOSE'
export const ACTIVITY_OVERLAY_GO_BACK = 'ACTIVITY_OVERLAY_GO_BACK'

export const ADMIN_BAN_USER_BEGIN = 'ADMIN_BAN_USER_BEGIN'
export const ADMIN_BAN_USER = 'ADMIN_BAN_USER'
export const ADMIN_GET_BAN_HISTORY_BEGIN = 'ADMIN_GET_BAN_HISTORY_BEGIN'
export const ADMIN_GET_BAN_HISTORY = 'ADMIN_GET_BAN_HISTORY'
export const ADMIN_GET_INVITES_BEGIN = 'ADMIN_GET_INVITES_BEGIN'
export const ADMIN_GET_INVITES = 'ADMIN_GET_INVITES'
export const ADMIN_GET_PERMISSIONS_BEGIN = 'ADMIN_GET_PERMISSIONS_BEGIN'
export const ADMIN_GET_PERMISSIONS = 'ADMIN_GET_PERMISSIONS'
export const ADMIN_ACCEPT_USER_BEGIN = 'ADMIN_ACCEPT_USER_BEGIN'
export const ADMIN_ACCEPT_USER = 'ADMIN_ACCEPT_USER'
export const ADMIN_MAP_POOL_CLEAR_SEARCH = 'ADMIN_MAP_POOL_CLEAR_SEARCH'
export const ADMIN_MAP_POOL_CREATE_BEGIN = 'ADMIN_MAP_POOL_CREATE_BEGIN'
export const ADMIN_MAP_POOL_CREATE = 'ADMIN_MAP_POOL_CREATE'
export const ADMIN_MAP_POOL_DELETE_BEGIN = 'ADMIN_MAP_POOL_DELETE_BEGIN'
export const ADMIN_MAP_POOL_DELETE = 'ADMIN_MAP_POOL_DELETE'
export const ADMIN_MAP_POOL_GET_HISTORY_BEGIN = 'ADMIN_MAP_POOL_GET_HISTORY_BEGIN'
export const ADMIN_MAP_POOL_GET_HISTORY = 'ADMIN_MAP_POOL_GET_HISTORY'
export const ADMIN_MAP_POOL_SEARCH_MAPS_BEGIN = 'ADMIN_MAP_POOL_SEARCH_MAPS_BEGIN'
export const ADMIN_MAP_POOL_SEARCH_MAPS = 'ADMIN_MAP_POOL_SEARCH_MAPS'
export const ADMIN_SET_PERMISSIONS_BEGIN = 'ADMIN_SET_PERMISSIONS_BEGIN'
export const ADMIN_SET_PERMISSIONS = 'ADMIN_SET_PERMISSIONS'

// The AudioManager has finished initializing and is ready to play sounds
export const AUDIO_MANAGER_INITIALIZED = 'AUDIO_MANAGER_INITIALIZED'

export const AUTH_CHANGE_BEGIN = 'AUTH_CHANGE_BEGIN'
export const AUTH_LOG_IN = 'AUTH_LOG_IN'
export const AUTH_LOG_OUT = 'AUTH_LOG_OUT'
export const AUTH_RESET_PASSWORD = 'AUTH_RESET_PASSWORD'
export const AUTH_RETRIEVE_USERNAME = 'AUTH_RETRIEVE_USERNAME'
export const AUTH_SEND_VERIFICATION_EMAIL = 'AUTH_SEND_VERIFICATION_EMAIL'
export const AUTH_START_PASSWORD_RESET = 'AUTH_START_PASSWORD_RESET'
export const AUTH_SIGN_UP = 'AUTH_SIGN_UP'
export const AUTH_UPDATE = 'AUTH_UPDATE'
// Our email has been successfully verified
export const AUTH_UPDATE_EMAIL_VERIFIED = 'AUTH_UPDATE_EMAIL_VERIFIED'
export const AUTH_VERIFY_EMAIL = 'AUTH_VERIFY_EMAIL'

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
// We are starting the process of joining a new channel
export const CHAT_JOIN_CHANNEL_BEGIN = 'CHAT_JOIN_CHANNEL_BEGIN'
// The server has responded with success/failure of our joining the channel; if the channel hasn't
// exist up until we joined it, we'll get full permissions in it
export const CHAT_JOIN_CHANNEL = 'CHAT_JOIN_CHANNEL'
// We are starting the process of leaving a channel we're in
export const CHAT_LEAVE_CHANNEL_BEGIN = 'CHAT_LEAVE_CHANNEL_BEGIN'
// The server has responded with success/failure of our leaving the channel; if we had any
// permissions in it, they are lost now, even if we rejoin it (unless it's empty when we do)
export const CHAT_LEAVE_CHANNEL = 'CHAT_LEAVE_CHANNEL'
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
// A user has joined the channel we're in
export const CHAT_UPDATE_JOIN = 'CHAT_UPDATE_JOIN'
// A user has left the channel we're in
export const CHAT_UPDATE_LEAVE = 'CHAT_UPDATE_LEAVE'
// We have left the channel we're in
export const CHAT_UPDATE_LEAVE_SELF = 'CHAT_UPDATE_LEAVE_SELF'
// We've received a message from a user in one of our joined channels
export const CHAT_UPDATE_MESSAGE = 'CHAT_UPDATE_MESSAGE'
// A user in one of our chat channels has become active (non-idle and online)
export const CHAT_UPDATE_USER_ACTIVE = 'CHAT_UPDATE_USER_ACTIVE'
// A user in one of our chat channels has become idle (still online, but not active)
export const CHAT_UPDATE_USER_IDLE = 'CHAT_UPDATE_USER_IDLE'
// A user in one of our chat channels has gone offline
export const CHAT_UPDATE_USER_OFFLINE = 'CHAT_UPDATE_USER_OFFLINE'

export const DIALOG_OPEN = 'DIALOG_OPEN'
export const DIALOG_CLOSE = 'DIALOG_CLOSE'

// We have clicked on a folder inside the file browser
export const FILE_BROWSER_CHANGE_PATH = 'FILE_BROWSER_CHANGE_PATH'
// Clear the list of files from the client
export const FILE_BROWSER_CLEAR_FILES = 'FILE_BROWSER_CLEAR_FILES'
// We are starting the process of getting the list of files (and folders) from a user's computer
export const FILE_BROWSER_GET_LIST_BEGIN = 'FILE_BROWSER_GET_LIST_BEGIN'
// We have received a response to our files retrieval (error or the list of the files for that
// particular folder)
export const FILE_BROWSER_GET_LIST = 'FILE_BROWSER_GET_LIST'

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

// We are starting the process of saving the settings
export const LOCAL_SETTINGS_SET_BEGIN = 'LOCAL_SETTINGS_SET_BEGIN'
// The server has responded with success/failure to our settings saving
export const LOCAL_SETTINGS_SET = 'LOCAL_SETTINGS_SET'
// The settings pertaining to this computer only have changed
export const LOCAL_SETTINGS_UPDATE = 'LOCAL_SETTINGS_UPDATE'

// We are starting the process of selecting a local map when creating a lobby (usually means
// uploading the map)
export const LOCAL_MAPS_SELECT_BEGIN = 'LOCAL_MAPS_SELECT_BEGIN'
// The server has responded with success/failure to us selecting the local map
export const LOCAL_MAPS_SELECT = 'LOCAL_MAPS_SELECT'

// We are beginning to retrieve details of a map from the server
export const MAPS_DETAILS_GET_BEGIN = 'MAPS_DETAILS_GET_BEGIN'
// We have received a response to our retrieval of map details (error or the map details)
export const MAPS_DETAILS_GET = 'MAPS_DETAILS_GET'
// Clear the list of maps from the client
export const MAPS_LIST_CLEAR = 'MAPS_LIST_CLEAR'
// We are beginning to retrieve the list of maps from the server
export const MAPS_LIST_GET_BEGIN = 'MAPS_LIST_GET_BEGIN'
// We have received a response to our map list retrieval (error or the list of maps)
export const MAPS_LIST_GET = 'MAPS_LIST_GET'
// We are starting the process of removing a map
export const MAPS_REMOVE_BEGIN = 'MAPS_REMOVE_BEGIN'
// The server has responded with success/failure to us removing a map
export const MAPS_REMOVE = 'MAPS_REMOVE'
// We are starting the process of toggling a favorite status of a map
export const MAPS_TOGGLE_FAVORITE_BEGIN = 'MAPS_TOGGLE_FAVORITE_BEGIN'
// The server has responded with success/failure of us toggling a favorite status of a map
export const MAPS_TOGGLE_FAVORITE = 'MAPS_TOGGLE_FAVORITE'
// We are starting the process of updating a map
export const MAPS_UPDATE_BEGIN = 'MAPS_UPDATE_BEGIN'
// The server has responded with success/failure to us updating a map
export const MAPS_UPDATE = 'MAPS_UPDATE'

// We are beginning to retrieve the map preferences from the server
export const MAPS_PREFERENCES_GET_BEGIN = 'MAPS_PREFERENCES_GET_BEGIN'
// The server has responded with success/failure to our retrieval of map preferences
export const MAPS_PREFERENCES_GET = 'MAPS_PREFERENCES_GET'
// We are beginning to update the map preferences to the server
export const MAPS_PREFERENCES_UPDATE_BEGIN = 'MAPS_PREFERENCES_UPDATE_BEGIN'
// The server has responded with success/failure to us updating the map preferences
export const MAPS_PREFERENCES_UPDATE = 'MAPS_PREFERENCES_UPDATE'

// We are starting the process of accepting the match
export const MATCHMAKING_ACCEPT_BEGIN = 'MATCHMAKING_ACCEPT_BEGIN'
// The server has responded with success/failure to us accepting the match
export const MATCHMAKING_ACCEPT = 'MATCHMAKING_ACCEPT'
// We are starting the process of canceling the match finding
export const MATCHMAKING_CANCEL_BEGIN = 'MATCHMAKING_CANCEL_BEGIN'
// The server has responded with success/failure to us canceling the match finding
export const MATCHMAKING_CANCEL = 'MATCHMAKING_CANCEL'
// We are starting the matchmaking process to find game
export const MATCHMAKING_FIND_BEGIN = 'MATCHMAKING_FIND_BEGIN'
// The server has responded with success/failure to us starting to find game
export const MATCHMAKING_FIND = 'MATCHMAKING_FIND'
// Some (or all) of the players have failed to accept the match
export const MATCHMAKING_UPDATE_ACCEPT_MATCH_FAILED = 'MATCHMAKING_UPDATE_ACCEPT_MATCH_FAILED'
// The accept match time has changed
export const MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME = 'MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME'
// The server has responded that a player has accepted the match
export const MATCHMAKING_UPDATE_MATCH_ACCEPTED = 'MATCHMAKING_UPDATE_MATCH_ACCEPTED'
// The server has responded with a found match
export const MATCHMAKING_UPDATE_MATCH_FOUND = 'MATCHMAKING_UPDATE_MATCH_FOUND'
// The server has responded that all players have accepted the match and game is ready to start
export const MATCHMAKING_UPDATE_MATCH_READY = 'MATCHMAKING_UPDATE_MATCH_READY'
// Our status has changed, ie. one of our clients is searching for a game or has stopped searching
export const MATCHMAKING_UPDATE_STATUS = 'MATCHMAKING_UPDATE_STATUS'

export const NETWORK_SITE_CONNECTED = 'NETWORK_SITE_CONNECTED'
export const NETWORK_SITE_DISCONNECTED = 'NETWORK_SITE_DISCONNECTED'

// We have started the process of launching the game with the selected replay in it
export const REPLAYS_START_REPLAY = 'REPLAYS_START_REPLAY'

export const SERVER_STATUS = 'SERVER_STATUS'

export const SNACKBAR_OPEN = 'SNACKBAR_OPEN'
export const SNACKBAR_CLOSE = 'SNACKBAR_CLOSE'

// The process of attempting to downgrade an existing StarCraft installation has begun
export const STARCRAFT_DOWNGRADE_BEGIN = 'STARCRAFT_DOWNGRADE_BEGIN'
// The process of downgrading an existing StarCraft installation has succeeded or failed. On
// success, it is *likely* that the StarCraft path is now valid
export const STARCRAFT_DOWNGRADE = 'STARCRAFT_DOWNGRADE'
// An updated StarCraft path validity status, stating whether or not the current path setting
// contains an accessible starcraft.exe
export const STARCRAFT_PATH_VALIDITY = 'STARCRAFT_PATH_VALIDITY'
// An updated StarCraft remastered status, stating whether or not the current path setting contains
// a StarCraft:Remastered version or not
export const STARCRAFT_REMASTERED_STATUS = 'STARCRAFT_REMASTERED_STATUS'
// An updated StarCraft version validity status, stating whether or not the StarCraft exe at the
// current path is a version we are compatible with
export const STARCRAFT_VERSION_VALIDITY = 'STARCRAFT_VERSION_VALIDITY'

// The server has finished subscribing this particular client to the things it needs to be in (e.g.
// lobbies) and giving it initial data
export const SUBSCRIPTIONS_CLIENT_LOADING_COMPLETE = 'SUBSCRIPTIONS_CLIENT_LOADING_COMPLETE'
// The server has finished subscribing this user (across clients) to the things it needs
export const SUBSCRIPTIONS_USER_LOADING_COMPLETE = 'SUBSCRIPTIONS_USER_LOADING_COMPLETE'

// The auto-updater has found that a new version is available and a download is in progress
export const UPDATER_NEW_VERSION_FOUND = 'UPDATER_NEW_VERSION_FOUND'
// The auto-updater has terminated downloading a new version (successfully or unsuccessfully). If
// successful, it is ready to restart and install it.
export const UPDATER_NEW_VERSION_DOWNLOADED = 'UPDATER_NEW_VERSION_DOWNLOADED'
// The auto-updater determined that we're using the latest version
export const UPDATER_UP_TO_DATE = 'UPDATER_UP_TO_DATE'

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
// Notifies that a user has brought a whisper into a visible state (and things like last read
// message should be updated)
export const WHISPERS_SESSION_ACTIVATE = 'WHISPERS_SESSION_ACTIVATE'
// Notifies that a whisper is no longer visible to the user, and can be cleaned up as
// appropriate (trimming its messsage list to a minimal amount, for instance)
export const WHISPERS_SESSION_DEACTIVATE = 'WHISPERS_SESSION_DEACTIVATE'
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
