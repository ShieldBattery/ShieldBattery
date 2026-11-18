import { describe, expect, test } from 'vitest'
import { GameStatus } from '../../common/games/game-status'
import {
  isCrashExitCode,
  shouldRelaunchAfterExit,
  UNFINISHED_IMPORT_TABLE_EXIT_CODE,
} from './crash-exit-code'

describe('isCrashExitCode', () => {
  test('recognizes unhandled-exception NTSTATUS codes', () => {
    expect(isCrashExitCode(0xc0000005)).toBe(true) // access violation
    expect(isCrashExitCode(0xc00000fd)).toBe(true) // stack overflow
    expect(isCrashExitCode(0xc0000409)).toBe(true) // fail fast
  })

  test('recognizes the same codes when delivered as signed 32-bit values', () => {
    expect(isCrashExitCode(0xc0000005 | 0)).toBe(true)
    expect(isCrashExitCode(0xc00000fd | 0)).toBe(true)
  })

  test('recognizes the DLL panic hook exit code', () => {
    expect(isCrashExitCode(0x4230daef)).toBe(true)
  })

  test('recognizes the unfinished import table exit code', () => {
    expect(isCrashExitCode(UNFINISHED_IMPORT_TABLE_EXIT_CODE)).toBe(true)
  })

  test('ignores normal exits and non-crash failure codes', () => {
    expect(isCrashExitCode(0)).toBe(false)
    expect(isCrashExitCode(1)).toBe(false)
    expect(isCrashExitCode(0x40010004)).toBe(false) // informational NTSTATUS
    expect(isCrashExitCode(0x80000003)).toBe(false) // warning severity (breakpoint)
  })
})

describe('shouldRelaunchAfterExit', () => {
  test('relaunches the first attempt that crashed on an unfinished import table', () => {
    expect(
      shouldRelaunchAfterExit(UNFINISHED_IMPORT_TABLE_EXIT_CODE, 1, GameStatus.Launching),
    ).toBe(true)
  })

  test('relaunches only once', () => {
    expect(
      shouldRelaunchAfterExit(UNFINISHED_IMPORT_TABLE_EXIT_CODE, 2, GameStatus.Launching),
    ).toBe(false)
  })

  test('does not relaunch after other exits', () => {
    for (const code of [0, 1, 0xc0000005, 0xc0000005 | 0, 0x4230daef]) {
      expect(shouldRelaunchAfterExit(code, 1, GameStatus.Launching), `0x${code.toString(16)}`).toBe(
        false,
      )
    }
  })

  test('relaunches only a game that is still launching', () => {
    for (const status of [
      GameStatus.Configuring,
      GameStatus.Playing,
      GameStatus.Unknown,
      GameStatus.Error,
      undefined,
    ]) {
      expect(
        shouldRelaunchAfterExit(UNFINISHED_IMPORT_TABLE_EXIT_CODE, 1, status),
        `status ${status}`,
      ).toBe(false)
    }
  })
})
