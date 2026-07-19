// Base names for the app's rotating log files. Namespaced by `SB_SESSION` — exactly like the
// settings files (`settings-<session>.json`, etc.) — so multiple dev app instances don't share a
// log dir slot. Without `SB_SESSION` (i.e. production) the bare names are used, so this is a no-op
// there.
//
// The launcher (which tells the game DLL where to write), the app logger, and the bug-report
// collector all derive their names from here so they can never drift apart.

function sessionSuffix(): string {
  const session = process.env.SB_SESSION
  return session ? `-${session}` : ''
}

/** Base name for the Electron app's rotating log (`app.0.log` / `app-<session>.0.log`). */
export function appLogBaseName(): string {
  return `app${sessionSuffix()}`
}

/**
 * Base name for the injected game DLL's rotating log (`game.0.log` / `game-<session>.0.log`).
 * Passed to the DLL at launch; the DLL appends the rotating `.<i>.log` slot.
 */
export function gameLogBaseName(): string {
  return `game${sessionSuffix()}`
}
