// Flags that can be used to turn features on/off (both on the client and the server). There are
// three modes: Off (off everywhere), Dev (on only when the server is not running production mode),
// and On (on everywhere). To add a new flag, just declare it as an export here, and set its value
// to the return value of the right level (e.g. `DEV()`), then check it in any relevant code paths.

/* eslint-disable @typescript-eslint/no-unused-vars */
const OFF = () => false
const DEV = () => process.env.NODE_ENV !== 'production'
const ON = () => true
/* eslint-enable @typescript-eslint/no-unused-vars */

// Show the "dev mode" indicator on the site (don't move this past dev mode)
export const DEV_INDICATOR = DEV()
// Allow users to join multiple channels (and leave channels)
export const MULTI_CHANNEL = DEV()
// Allow matchmaking related features (find match, matchmaking map pools, preferences, etc.)
export const MATCHMAKING = ON()
// Allow launching with BW 1.16.1 installation
export const BW_1161 = DEV()
// Allow party related features (invite players, decline/accept an invite, etc.)
export const PARTIES = DEV()
/** Allow users to view profiles of other users and themselves. */
export const USER_PROFILES = ON()
