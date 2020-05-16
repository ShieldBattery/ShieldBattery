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
export const SETTINGS_CHANGED = 'SETTINGS_CHANGED'
// Cause the main process to immediately emit a SETTINGS_CHANGED event
export const SETTINGS_EMIT = 'SETTINGS_EMIT'
export const SETTINGS_EMIT_ERROR = 'SETTINGS_EMIT_ERROR'
// Pass a new settings object from the renderer -> main process (to be merged with the existing one)
export const SETTINGS_MERGE = 'SETTINGS_MERGE'
export const SETTINGS_MERGE_ERROR = 'SETTINGS_MERGE_ERROR'

export const WINDOW_CLOSE = 'WINDOW_CLOSE'
export const WINDOW_MAXIMIZE = 'WINDOW_MAXIMIZE'
export const WINDOW_MINIMIZE = 'WINDOW_MINIMIZE'

// Tells a renderer process that a window's maximized state has been changed
export const WINDOW_MAXIMIZED_STATE = 'WINDOW_MAXIMIZED_STATE'
