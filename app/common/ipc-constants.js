// Channel names for electron IPC (used in the main and renderer processes for passing messages)

// A new log message is being emitted
export const LOG_MESSAGE = 'LOG_MESSAGE'

// The local settings have changed (includes the new settings)
export const SETTINGS_CHANGED = 'SETTINGS_CHANGED'
// Cause the main process to immediately emit a SETTINGS_CHANGED event
export const SETTINGS_EMIT = 'SETTINGS_EMIT'
export const SETTINGS_EMIT_ERROR = 'SETTINGS_EMIT_ERROR'
// Pass a new settings object from the renderer -> main process (to be merged with the existing one)
export const SETTINGS_MERGE = 'SETTINGS_MERGE'
export const SETTINGS_MERGE_ERROR = 'SETTINGS_MERGE_ERROR'

// The renderer has chosen a server to connect to (generally called when initializing the app)
export const UPDATE_SERVER = 'UPDATE_SERVER'
// The main process has finished updating the server
export const UPDATE_SERVER_COMPLETE = 'UPDATE_SERVER_COMPLETE'

export const WINDOW_CLOSE = 'WINDOW_CLOSE'
export const WINDOW_MAXIMIZE = 'WINDOW_MAXIMIZE'
export const WINDOW_MINIMIZE = 'WINDOW_MINIMIZE'
