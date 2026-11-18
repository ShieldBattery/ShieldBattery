import { GameStatus } from '../../common/games/game-status'

/** Exit code the game DLL's panic hook terminates the process with. */
const RUST_PANIC_EXIT_CODE = 0x4230daef
/**
 * Smallest NTSTATUS with the error severity bits (the top two) set. An unhandled exception ends
 * the process with the exception's NTSTATUS as its exit code, so a crash exit is anything at or
 * above this (0xC0000005 access violation, 0xC00000FD stack overflow, ...).
 */
const NTSTATUS_ERROR_SEVERITY = 0xc0000000
/**
 * Exit code the game DLL ends the process with when the game crashed before its init because
 * SC:R's exe packer left the exe's import table unfinished. Launching again normally succeeds.
 *
 * This value is duplicated as `UNFINISHED_IMPORT_TABLE_EXIT_CODE` in game/src/crash_dump.rs; the
 * two must be kept the same.
 */
export const UNFINISHED_IMPORT_TABLE_EXIT_CODE = 0x2bad1a7e

/**
 * Returns whether a game process exit code means the process crashed (unhandled exception or a
 * Rust panic in the DLL), rather than exiting on its own terms.
 *
 * Exit codes may arrive as signed 32-bit values; comparisons are done on the unsigned form.
 */
export function isCrashExitCode(exitCode: number): boolean {
  const unsigned = exitCode >>> 0
  return (
    unsigned >= NTSTATUS_ERROR_SEVERITY ||
    unsigned === RUST_PANIC_EXIT_CODE ||
    unsigned === UNFINISHED_IMPORT_TABLE_EXIT_CODE
  )
}

/**
 * Returns whether a game whose process just exited with `exitCode` should be launched again in a
 * new process. Only a crash on an unfinished import table is, and only once per game: `attempt`
 * is which launch of the game the process was, counting from 1. The process must also have exited
 * before connecting to the app (`status` still {@link GameStatus.Launching}), which that crash
 * always does, so nothing about the game had been set up in it yet.
 */
export function shouldRelaunchAfterExit(
  exitCode: number,
  attempt: number,
  status: GameStatus | undefined,
): boolean {
  return (
    exitCode >>> 0 === UNFINISHED_IMPORT_TABLE_EXIT_CODE &&
    attempt === 1 &&
    status === GameStatus.Launching
  )
}
