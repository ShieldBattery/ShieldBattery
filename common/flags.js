// Flags that can be used to turn features on/off (both on the client and the server). There are
// three modes: Off (off everywhere), Dev (on only when the server is not running production mode),
// and On (on everywhere). To add a new flag, just declare it as an export here, and set its value
// to the return value of the right level (e.g. `DEV()`), then check it in any relevant code paths.

/* eslint-disable no-unused-vars */
const OFF = () => false
const DEV = () => process.env.NODE_ENV !== 'production'
const ON = () => true
/* eslint-enable no-unused-vars */

// Show the "dev mode" indicator on the site (don't move this past dev mode)
export const DEV_INDICATOR = DEV()
// Allow users to join multiple channels (and leave channels)
export const MULTI_CHANNEL = DEV()
// Allow hosting custom maps / let regular users upload maps
export const MAP_UPLOADING = DEV()
// Allow matchmaking related features (find match, matchmaking map pools, preferences, etc.)
export const MATCHMAKING = DEV()
// Allow launching with remastered installation
export const REMASTERED = DEV()
// Enable the downgrade functionality
export const DOWNGRADE = OFF()
