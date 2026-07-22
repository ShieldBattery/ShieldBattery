import { describe, expect, test } from 'vitest'
import { pickSaveFilename, sanitizeBaseFilename } from './replay-save-naming'

describe('app/replay-library/replay-save-naming/sanitizeBaseFilename', () => {
  test('leaves a plain name unchanged', () => {
    expect(sanitizeBaseFilename('SB-1v1-Fighting_Spirit-1703692800')).toBe(
      'SB-1v1-Fighting_Spirit-1703692800',
    )
  })

  test('strips a posix directory path', () => {
    expect(sanitizeBaseFilename('../../etc/passwd')).toBe('passwd')
  })

  test('strips a windows directory path', () => {
    expect(sanitizeBaseFilename('C:\\Windows\\System32\\evil')).toBe('evil')
  })
})

describe('app/replay-library/replay-save-naming/pickSaveFilename', () => {
  function lookup(existing: Record<string, string>) {
    return async (name: string) => existing[name]
  }

  test('uses the plain name when nothing exists there', async () => {
    const result = await pickSaveFilename('replay', 'hash-a', lookup({}))
    expect(result).toEqual({ name: 'replay.rep', alreadyExists: false })
  })

  test('reuses the plain name when it already holds identical content', async () => {
    const result = await pickSaveFilename('replay', 'hash-a', lookup({ 'replay.rep': 'hash-a' }))
    expect(result).toEqual({ name: 'replay.rep', alreadyExists: true })
  })

  test('falls back to a numbered name when the plain name holds different content', async () => {
    const result = await pickSaveFilename('replay', 'hash-a', lookup({ 'replay.rep': 'hash-b' }))
    expect(result).toEqual({ name: 'replay (2).rep', alreadyExists: false })
  })

  test('reuses a numbered name when it holds identical content', async () => {
    const result = await pickSaveFilename(
      'replay',
      'hash-a',
      lookup({ 'replay.rep': 'hash-b', 'replay (2).rep': 'hash-a' }),
    )
    expect(result).toEqual({ name: 'replay (2).rep', alreadyExists: true })
  })

  test('walks past multiple mismatched collisions to find a free slot', async () => {
    const result = await pickSaveFilename(
      'replay',
      'hash-a',
      lookup({
        'replay.rep': 'hash-b',
        'replay (2).rep': 'hash-c',
        'replay (3).rep': 'hash-d',
      }),
    )
    expect(result).toEqual({ name: 'replay (4).rep', alreadyExists: false })
  })
})
