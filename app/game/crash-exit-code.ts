/** Exit code the game DLL's panic hook terminates the process with. */
const RUST_PANIC_EXIT_CODE = 0x4230daef
/**
 * Smallest NTSTATUS with the error severity bits (the top two) set. An unhandled exception ends
 * the process with the exception's NTSTATUS as its exit code, so a crash exit is anything at or
 * above this (0xC0000005 access violation, 0xC00000FD stack overflow, ...).
 */
const NTSTATUS_ERROR_SEVERITY = 0xc0000000

/**
 * Returns whether a game process exit code means the process crashed (unhandled exception or a
 * Rust panic in the DLL), rather than exiting on its own terms.
 *
 * Exit codes may arrive as signed 32-bit values; comparisons are done on the unsigned form.
 */
export function isCrashExitCode(exitCode: number): boolean {
  const unsigned = exitCode >>> 0
  return unsigned >= NTSTATUS_ERROR_SEVERITY || unsigned === RUST_PANIC_EXIT_CODE
}
