import { describe, expect, test } from 'vitest'
import {
  encodeViewPathname,
  isShowingLibraryHref,
  parseViewPathname,
  replaysHrefFromRemembered,
  searchForViewChange,
} from './replay-library-urls'

describe('parseViewPathname / encodeViewPathname', () => {
  test('parses "/replays" and "/replays/" as the "all" view', () => {
    expect(parseViewPathname('/replays')).toEqual({ kind: 'all' })
    expect(parseViewPathname('/replays/')).toEqual({ kind: 'all' })
  })

  test('parses "/replays/bookmarked" and its trailing-slash form as the bookmarked view', () => {
    expect(parseViewPathname('/replays/bookmarked')).toEqual({ kind: 'bookmarked' })
    expect(parseViewPathname('/replays/bookmarked/')).toEqual({ kind: 'bookmarked' })
  })

  test('parses "/replays/playlists/<id>" as a playlist view', () => {
    expect(parseViewPathname('/replays/playlists/42')).toEqual({ kind: 'playlist', id: 42 })
  })

  test('parses "/replays/folders" and its trailing-slash form as the folders view', () => {
    expect(parseViewPathname('/replays/folders')).toEqual({ kind: 'folders' })
    expect(parseViewPathname('/replays/folders/')).toEqual({ kind: 'folders' })
  })

  test('falls back to "all" for extra segments under the folders view', () => {
    expect(parseViewPathname('/replays/folders/C:')).toEqual({ kind: 'all' })
  })

  test('falls back to "all" for a playlists subpath missing an id', () => {
    expect(parseViewPathname('/replays/playlists')).toEqual({ kind: 'all' })
  })

  test('falls back to "all" for a malformed playlist id', () => {
    expect(parseViewPathname('/replays/playlists/notanumber')).toEqual({ kind: 'all' })
  })

  test('falls back to "all" for an unrecognized subpath', () => {
    expect(parseViewPathname('/replays/something-else')).toEqual({ kind: 'all' })
  })

  test('encodes each view kind to its canonical pathname', () => {
    expect(encodeViewPathname({ kind: 'all' })).toBe('/replays')
    expect(encodeViewPathname({ kind: 'bookmarked' })).toBe('/replays/bookmarked')
    expect(encodeViewPathname({ kind: 'playlist', id: 42 })).toBe('/replays/playlists/42')
    expect(encodeViewPathname({ kind: 'folders' })).toBe('/replays/folders')
  })

  test('round-trips a playlist view through encode then parse', () => {
    expect(parseViewPathname(encodeViewPathname({ kind: 'playlist', id: 7 }))).toEqual({
      kind: 'playlist',
      id: 7,
    })
  })
})

describe('searchForViewChange', () => {
  test('carries the filters but drops the folder when leaving the folders view', () => {
    expect(
      searchForViewChange('?mapName=Fighting&folder=C%3A%5Creplays', { kind: 'all' }, 'C:\\x'),
    ).toBe('?mapName=Fighting')
    expect(searchForViewChange('?folder=C%3A%5Creplays', { kind: 'bookmarked' }, undefined)).toBe(
      '',
    )
    expect(
      searchForViewChange('?folder=C%3A%5Creplays&sort=oldest', { kind: 'playlist', id: 3 }, 'x'),
    ).toBe('?sort=oldest')
  })

  test('entering the folders view reopens the remembered folder', () => {
    expect(searchForViewChange('?mapName=Fighting', { kind: 'folders' }, 'C:\\replays')).toBe(
      '?mapName=Fighting&folder=C%3A%5Creplays',
    )
  })

  test('entering the folders view with nothing remembered opens the top level', () => {
    expect(searchForViewChange('?sort=oldest', { kind: 'folders' }, undefined)).toBe('?sort=oldest')
  })
})

describe('replaysHrefFromRemembered', () => {
  test('reopens each remembered view', () => {
    expect(replaysHrefFromRemembered('/replays', '')).toBe('/replays')
    expect(replaysHrefFromRemembered('/replays/bookmarked', '')).toBe('/replays/bookmarked')
    expect(replaysHrefFromRemembered('/replays/playlists/7', '')).toBe('/replays/playlists/7')
  })

  test('the folders view carries the remembered folder', () => {
    expect(replaysHrefFromRemembered('/replays/folders', 'C:\\replays\\2024')).toBe(
      '/replays/folders?folder=C%3A%5Creplays%5C2024',
    )
  })

  test('the folders view with no remembered folder opens its top level', () => {
    expect(replaysHrefFromRemembered('/replays/folders', '')).toBe('/replays/folders')
    expect(replaysHrefFromRemembered('/replays/folders', undefined)).toBe('/replays/folders')
    expect(replaysHrefFromRemembered('/replays/folders', 42)).toBe('/replays/folders')
  })

  test('a remembered folder only rides along into the folders view', () => {
    expect(replaysHrefFromRemembered('/replays/bookmarked', 'C:\\replays')).toBe(
      '/replays/bookmarked',
    )
  })

  test('an unusable stored view reopens the whole library', () => {
    expect(replaysHrefFromRemembered(undefined, '')).toBe('/replays')
    expect(replaysHrefFromRemembered(null, '')).toBe('/replays')
    expect(replaysHrefFromRemembered(12, '')).toBe('/replays')
    expect(replaysHrefFromRemembered({ kind: 'bookmarked' }, '')).toBe('/replays')
    expect(replaysHrefFromRemembered('/replays/playlists/nope', '')).toBe('/replays')
    expect(replaysHrefFromRemembered('/replays/what/ever/else', 'C:\\x')).toBe('/replays')
  })

  test('a stored view in a non-canonical form is canonicalized', () => {
    expect(replaysHrefFromRemembered('/replays/bookmarked/', '')).toBe('/replays/bookmarked')
  })
})

describe('isShowingLibraryHref', () => {
  test('matches the view the href addresses, ignoring trailing slashes and the search', () => {
    expect(isShowingLibraryHref('/replays/', '/replays')).toBe(true)
    expect(isShowingLibraryHref('/replays/bookmarked', '/replays/bookmarked')).toBe(true)
    expect(isShowingLibraryHref('/replays/folders', '/replays/folders?folder=C%3A%5Cx')).toBe(true)
  })

  test('a different view or page is not showing it', () => {
    expect(isShowingLibraryHref('/replays', '/replays/bookmarked')).toBe(false)
    expect(isShowingLibraryHref('/replays/playlists/3', '/replays/playlists/4')).toBe(false)
    expect(isShowingLibraryHref('/games', '/replays')).toBe(false)
    expect(isShowingLibraryHref('/', '/replays')).toBe(false)
  })
})
