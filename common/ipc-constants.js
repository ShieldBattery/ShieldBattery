// Channel names for electron IPC (used in the main and renderer processes for passing messages)

// A new log message is being emitted
export const LOG_MESSAGE = 'LOG_MESSAGE'

// Tells the main process that a renderer process is now connected to the site
export const NETWORK_SITE_CONNECTED = 'NETWORK_SITE_CONNECTED'

// Tells the main process that there has been a new message posted in either the chat channels,
// whisper session, or inside a lobby
export const NEW_CHAT_MESSAGE = 'NEW_CHAT_MESSAGE'

// Tells a renderer process that a new version was found, but failed to download
export const NEW_VERSION_DOWNLOAD_ERROR = 'NEW_VERSION_DOWNLOAD_ERROR'
// Tells a renderer process that a new version has been downloaded (and can be installed)
export const NEW_VERSION_DOWNLOADED = 'NEW_VERSION_DOWNLOADED'
// Tells a renderer process that a new version has been found (and is in the process of being
// downloaded)
export const NEW_VERSION_FOUND = 'NEW_VERSION_FOUND'
// Forces the main process to give a particular renderer process the current auto-updater state
export const NEW_VERSION_GET_STATE = 'NEW_VERSION_GET_STATE'
// Tells the main process that it should restart and install the downloaded new version
export const NEW_VERSION_RESTART = 'NEW_VERSION_RESTART'
// Tells a renderer process that the current app version is up to date
export const NEW_VERSION_UP_TO_DATE = 'NEW_VERSION_UP_TO_DATE'

// The local settings have changed (includes the new settings)
export const LOCAL_SETTINGS_CHANGED = 'LOCAL_SETTINGS_CHANGED'
// Cause the main process to immediately emit a LOCAL_SETTINGS_CHANGED event
export const LOCAL_SETTINGS_GET = 'LOCAL_SETTINGS_GET'
// Tells a renderer process that there has been an error getting the local settings
export const LOCAL_SETTINGS_GET_ERROR = 'LOCAL_SETTINGS_GET_ERROR'
// Pass a new local settings from the renderer -> main process (to be merged with the existing one)
export const LOCAL_SETTINGS_MERGE = 'LOCAL_SETTINGS_MERGE'
// Tells a renderer process that there has been an error merging the local settings
export const LOCAL_SETTINGS_MERGE_ERROR = 'LOCAL_SETTINGS_MERGE_ERROR'
// The SC:R settings have changed (includes the new settings)
export const SCR_SETTINGS_CHANGED = 'SCR_SETTINGS_CHANGED'
// Cause the main process to immediately emit a SCR_SETTINGS_CHANGED event
export const SCR_SETTINGS_GET = 'SCR_SETTINGS_GET'
// Tells a renderer process that there has been an error getting the SC:R settings
export const SCR_SETTINGS_GET_ERROR = 'SCR_SETTINGS_GET_ERROR'
// Pass a new SC:R settings from the renderer -> main process (to be merged with the existing one)
export const SCR_SETTINGS_MERGE = 'SCR_SETTINGS_MERGE'
// Tells a renderer process that there has been an error merging the SC:R settings
export const SCR_SETTINGS_MERGE_ERROR = 'SCR_SETTINGS_MERGE_ERROR'
// Cause the main process to overwrite SC:R settings
export const SCR_SETTINGS_OVERWRITE = 'SCR_SETTINGS_OVERWRITE'

// Tells the main process that something has happened that requires a user's attention and to get it
// somehow (by e.g. flashing the window)
export const USER_ATTENTION_REQUIRED = 'USER_ATTENTION_REQUIRED'

export const WINDOW_CLOSE = 'WINDOW_CLOSE'
export const WINDOW_MAXIMIZE = 'WINDOW_MAXIMIZE'
export const WINDOW_MINIMIZE = 'WINDOW_MINIMIZE'

// Tells a renderer process that a window's maximized state has been changed
export const WINDOW_MAXIMIZED_STATE = 'WINDOW_MAXIMIZED_STATE'
