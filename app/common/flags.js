// Flags that can be used to turn features on/off (both on the client and the server). There are
// three modes: Off (off everywhere), Dev (on only when the server is not running production mode),
// and On (on everywhere). To add a new flag, just declare it as an export here, and set its value
// to the return value of the right level (e.g. `DEV()`), then check it in any relevant code paths.

/* eslint-disable no-unused-vars */
const OFF = () => false
const DEV = () => process.env.NODE_ENV !== 'production'
const ON = () => process.env.NODE_ENV === 'production'
/* eslint-enable no-unused-vars */

// Show the "dev mode" indicator on the site (don't move this past dev mode)
export const DEV_INDICATOR = DEV()
// Allow users to join multiple channels (and leave channels)
export const MULTI_CHANNEL = DEV()
