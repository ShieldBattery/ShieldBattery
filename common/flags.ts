// Flags that can be used to turn features on/off (both on the client and the server). There are
// three modes: Off (off everywhere), Dev (on only when the server is not running production mode),
// and On (on everywhere). To add a new flag, just declare it as an export here, and set its value
// to the return value of the right level (e.g. `DEV()`), then check it in any relevant code paths.

// Constants rather than functions so that a flag's value survives as a literal into whatever
// imports it. A call the bundler cannot evaluate leaves every `FLAG ? <ui/> : null` in the output,
// shipping the feature's markup to users who can never reach it; a folded constant lets it be
// dropped.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const OFF = false
const DEV = process.env.NODE_ENV !== 'production'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ON = true

/** Special error handling for local development */
export const DEV_ERROR = DEV
/** Show the "dev mode" indicator on the site (don't move this past dev mode). */
export const DEV_INDICATOR = DEV
