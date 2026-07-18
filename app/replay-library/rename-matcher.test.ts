import { describe, expect, test } from 'vitest'
import { matchRenamedReplays, NewFileIdentity, VanishedReplay } from './rename-matcher'

function vanished(overrides: Partial<VanishedReplay> = {}): VanishedReplay {
  return { path: '/old/a.rep', id: 1, fileSize: 100, contentHash: 'hash-a', ...overrides }
}

function newFile(overrides: Partial<NewFileIdentity> = {}): NewFileIdentity {
  return { path: '/new/a.rep', fileSize: 100, contentHash: 'hash-a', ...overrides }
}

describe('app/replay-library/rename-matcher/matchRenamedReplays', () => {
  test('matches a vanished file to a new file with the same size and hash', () => {
    const moves = matchRenamedReplays([vanished()], [newFile()])
    expect(moves).toEqual([{ id: 1, fromPath: '/old/a.rep', toPath: '/new/a.rep' }])
  })

  test('does not match when the content hash differs', () => {
    const moves = matchRenamedReplays([vanished()], [newFile({ contentHash: 'hash-b' })])
    expect(moves).toEqual([])
  })

  test('does not match when the file size differs', () => {
    const moves = matchRenamedReplays([vanished()], [newFile({ fileSize: 200 })])
    expect(moves).toEqual([])
  })

  test('a vanished row with a null content hash never matches', () => {
    const moves = matchRenamedReplays([vanished({ contentHash: null })], [newFile()])
    expect(moves).toEqual([])
  })

  test('a vanished row with a null file size never matches', () => {
    const moves = matchRenamedReplays([vanished({ fileSize: null })], [newFile()])
    expect(moves).toEqual([])
  })

  test('duplicate content: two vanished rows and two new files pair one-to-one', () => {
    const v1 = vanished({ path: '/old/a.rep', id: 1 })
    const v2 = vanished({ path: '/old/b.rep', id: 2 })
    const n1 = newFile({ path: '/new/a.rep' })
    const n2 = newFile({ path: '/new/b.rep' })

    const moves = matchRenamedReplays([v1, v2], [n1, n2])
    expect(moves).toEqual([
      { id: 1, fromPath: '/old/a.rep', toPath: '/new/a.rep' },
      { id: 2, fromPath: '/old/b.rep', toPath: '/new/b.rep' },
    ])
  })

  test('duplicate content: one vanished row only produces one move for two new files', () => {
    const v1 = vanished({ path: '/old/a.rep', id: 1 })
    const n1 = newFile({ path: '/new/a.rep' })
    const n2 = newFile({ path: '/new/b.rep' })

    const moves = matchRenamedReplays([v1], [n1, n2])
    expect(moves).toEqual([{ id: 1, fromPath: '/old/a.rep', toPath: '/new/a.rep' }])
  })
})
