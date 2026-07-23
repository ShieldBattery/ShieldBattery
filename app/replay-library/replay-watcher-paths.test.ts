import { describe, expect, test } from 'vitest'
import { isIndexedPathVanished, isPathUnderRoot } from './replay-watcher-paths'

describe('app/replay-library/replay-watcher-paths/isPathUnderRoot', () => {
  test('a file directly inside the root is under it', () => {
    expect(isPathUnderRoot('C:\\replays\\a.rep', 'C:\\replays')).toBe(true)
  })

  test('a file in a nested subfolder is under the root', () => {
    expect(isPathUnderRoot('C:\\replays\\sub\\deep\\a.rep', 'C:\\replays')).toBe(true)
  })

  test('a path equal to the root is under it', () => {
    expect(isPathUnderRoot('C:\\replays', 'C:\\replays')).toBe(true)
  })

  test('is case-insensitive', () => {
    expect(isPathUnderRoot('c:\\Replays\\A.REP', 'C:\\REPLAYS')).toBe(true)
  })

  test('normalizes forward slashes to match backslash roots', () => {
    expect(isPathUnderRoot('C:/replays/a.rep', 'C:\\replays')).toBe(true)
  })

  test('normalizes `.`/`..` segments', () => {
    expect(isPathUnderRoot('C:\\replays\\sub\\..\\a.rep', 'C:\\replays')).toBe(true)
  })

  test('respects separator boundaries (C:\\replays2 is not under C:\\replays)', () => {
    expect(isPathUnderRoot('C:\\replays2\\a.rep', 'C:\\replays')).toBe(false)
  })

  test('a sibling folder sharing a prefix is not under the root', () => {
    expect(isPathUnderRoot('C:\\replaysbackup\\a.rep', 'C:\\replays')).toBe(false)
  })

  test('a trailing separator on the root does not change containment', () => {
    expect(isPathUnderRoot('C:\\replays\\a.rep', 'C:\\replays\\')).toBe(true)
  })
})

describe('app/replay-library/replay-watcher-paths/isIndexedPathVanished', () => {
  const ROOT = 'C:\\replays'
  const OTHER = 'D:\\archive'

  test('a row under no configured root is pruned (root removed from settings)', () => {
    const vanished = isIndexedPathVanished(
      'C:\\replays\\a.rep',
      [OTHER],
      [OTHER],
      new Set<string>(),
      [],
    )
    expect(vanished).toBe(true)
  })

  test('with no configured roots, every indexed row is pruned', () => {
    // Removing every folder leaves an empty configured list: a row under no configured root is
    // pruned regardless of what scanned, so the whole index clears out.
    expect(isIndexedPathVanished('C:\\replays\\a.rep', [], [], new Set<string>(), [])).toBe(true)
  })

  test('a row under a configured-but-unreadable root is kept (offline drive)', () => {
    // ROOT is configured but not in scannedRoots (its top-level read failed this reconcile).
    const vanished = isIndexedPathVanished('C:\\replays\\a.rep', [ROOT], [], new Set<string>(), [
      ROOT,
    ])
    expect(vanished).toBe(false)
  })

  test('a row under a scanned root but missing from the scan is pruned', () => {
    const vanished = isIndexedPathVanished(
      'C:\\replays\\a.rep',
      [ROOT],
      [ROOT],
      new Set<string>(),
      [],
    )
    expect(vanished).toBe(true)
  })

  test('a row still present in the scan is kept', () => {
    const vanished = isIndexedPathVanished(
      'C:\\replays\\a.rep',
      [ROOT],
      [ROOT],
      new Set(['C:\\replays\\a.rep']),
      [],
    )
    expect(vanished).toBe(false)
  })

  test('a row under an unreadable subfolder of a scanned root is kept', () => {
    // The root's top-level read succeeded but a subfolder's read failed mid-walk (permission blip,
    // AV lock, offline junction). The file's absence from the scan proves nothing, so it's kept.
    const vanished = isIndexedPathVanished(
      'C:\\replays\\locked\\a.rep',
      [ROOT],
      [ROOT],
      new Set<string>(),
      ['C:\\replays\\locked'],
    )
    expect(vanished).toBe(false)
  })

  test('an unreadable subfolder elsewhere does not stop pruning of a genuinely-missing row', () => {
    const vanished = isIndexedPathVanished(
      'C:\\replays\\a.rep',
      [ROOT],
      [ROOT],
      new Set<string>(),
      ['C:\\replays\\locked'],
    )
    expect(vanished).toBe(true)
  })

  test('with nested roots, an unreadable inner root keeps rows even when the outer root scanned', () => {
    const inner = 'C:\\replays\\pro'
    // The inner root is a separately-mountable location (junction/network mount) that was offline
    // this reconcile, so its own read failed even though the outer ROOT scanned. Rows under it must
    // be kept: the outer walk couldn't enumerate them either.
    const vanished = isIndexedPathVanished(
      'C:\\replays\\pro\\a.rep',
      [ROOT, inner],
      [ROOT],
      new Set<string>(),
      [inner],
    )
    expect(vanished).toBe(false)
  })

  test('with nested roots both scanned, a genuinely-missing row is still pruned', () => {
    const inner = 'C:\\replays\\pro'
    const vanished = isIndexedPathVanished(
      'C:\\replays\\pro\\a.rep',
      [ROOT, inner],
      [ROOT, inner],
      new Set<string>(),
      [],
    )
    expect(vanished).toBe(true)
  })

  test('with nested roots, a file kept alive by any scanned containing root', () => {
    const inner = 'C:\\replays\\pro'
    // Neither the inner root nor ROOT scanned: the row must be kept.
    const vanished = isIndexedPathVanished(
      'C:\\replays\\pro\\a.rep',
      [ROOT, inner],
      [],
      new Set<string>(),
      [ROOT, inner],
    )
    expect(vanished).toBe(false)
  })

  test('separator-boundary: a sibling of a configured root is treated as removed', () => {
    // `C:\replays2` is not under `C:\replays`, so a row there is under no configured root.
    const vanished = isIndexedPathVanished(
      'C:\\replays2\\a.rep',
      [ROOT],
      [ROOT],
      new Set<string>(),
      [],
    )
    expect(vanished).toBe(true)
  })

  test('separator-boundary: an unreadable folder does not protect a sibling sharing its prefix', () => {
    // `C:\replays\pro2` is not under the unreadable `C:\replays\pro`, so it's still pruned.
    const vanished = isIndexedPathVanished(
      'C:\\replays\\pro2\\a.rep',
      [ROOT],
      [ROOT],
      new Set<string>(),
      ['C:\\replays\\pro'],
    )
    expect(vanished).toBe(true)
  })

  test('case-insensitive matching of scanned files keeps a present row', () => {
    // The scan stores the on-disk casing; the existing row uses the same source, so an exact-cased
    // hit is kept. A differently-cased configured root still recognizes containment.
    const vanished = isIndexedPathVanished(
      'C:\\Replays\\a.rep',
      ['c:\\replays'],
      ['c:\\replays'],
      new Set(['C:\\Replays\\a.rep']),
      [],
    )
    expect(vanished).toBe(false)
  })
})
