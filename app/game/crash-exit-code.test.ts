import { describe, expect, test } from 'vitest'
import { isCrashExitCode } from './crash-exit-code'

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

  test('ignores normal exits and non-crash failure codes', () => {
    expect(isCrashExitCode(0)).toBe(false)
    expect(isCrashExitCode(1)).toBe(false)
    expect(isCrashExitCode(0x40010004)).toBe(false) // informational NTSTATUS
    expect(isCrashExitCode(0x80000003)).toBe(false) // warning severity (breakpoint)
  })
})
