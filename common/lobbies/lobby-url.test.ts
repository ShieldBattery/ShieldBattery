import { describe, expect, test, vi } from 'vitest'
import { lobbyIdFromPath, lobbySlug, urlForLobby } from './lobby-url'
import { SbLobbyId } from './sb-lobby-id'

const LOBBY_ID = 'AbCdEfGhIjKlMnOpQrStUv' as SbLobbyId

describe('lobbies/lobby-url', () => {
  describe('lobbySlug', () => {
    test('uses the "_" placeholder when no name is provided', () => {
      expect(lobbySlug(undefined)).toBe('_')
    })

    test('uses the "_" placeholder for an empty name', () => {
      expect(lobbySlug('')).toBe('_')
    })

    test('slugifies a normal name', () => {
      expect(lobbySlug('My Cool Lobby 2')).toBe('my-cool-lobby-2')
    })

    test('falls back to the "_" placeholder when slug produces an empty string', async () => {
      // The `slug` package's default `fallback` option means it practically never returns an
      // empty string for a non-empty input in practice (it re-slugifies a base64 encoding of the
      // input instead). Mock it to hit that branch anyway, since `lobbySlug`'s `|| '_'` is what
      // keeps this function and the slug-correction effect from disagreeing if slug's behavior
      // (or configuration) ever changes.
      vi.resetModules()
      vi.doMock('slug', () => ({
        default: (str: string) => (str === '!!!' ? '' : str),
      }))

      const { lobbySlug: mockedLobbySlug } = await import('./lobby-url')
      expect(mockedLobbySlug('!!!')).toBe('_')

      vi.doUnmock('slug')
      vi.resetModules()
    })

    test('strips characters that are unsafe in a route param', () => {
      expect(lobbySlug('100% @home ♥')).not.toMatch(/[%@]/)
    })
  })

  describe('urlForLobby', () => {
    test('includes a slugified name when provided', () => {
      expect(urlForLobby(LOBBY_ID, 'My Cool Lobby 2')).toBe(`/lobbies/${LOBBY_ID}/my-cool-lobby-2`)
    })

    test('uses the "_" placeholder when no name is provided', () => {
      expect(urlForLobby(LOBBY_ID)).toBe(`/lobbies/${LOBBY_ID}/_`)
    })
  })

  describe('lobbyIdFromPath', () => {
    test('returns the id for a bare id path', () => {
      expect(lobbyIdFromPath(`/lobbies/${LOBBY_ID}`)).toBe(LOBBY_ID)
    })

    test('returns the id for a slugged path', () => {
      expect(lobbyIdFromPath(`/lobbies/${LOBBY_ID}/my-cool-lobby`)).toBe(LOBBY_ID)
    })

    test('returns the id when the path has a trailing slash', () => {
      expect(lobbyIdFromPath(`/lobbies/${LOBBY_ID}/`)).toBe(LOBBY_ID)
    })

    test('returns the id when there are extra segments after the slug', () => {
      expect(lobbyIdFromPath(`/lobbies/${LOBBY_ID}/my-cool-lobby/extra`)).toBe(LOBBY_ID)
    })

    test('returns undefined for the bare lobbies list path', () => {
      expect(lobbyIdFromPath('/lobbies')).toBeUndefined()
    })

    test('returns undefined for an invalid id segment', () => {
      expect(lobbyIdFromPath('/lobbies/not-a-valid-id')).toBeUndefined()
    })

    test('returns undefined for a non-lobby path', () => {
      expect(lobbyIdFromPath(`/games/${LOBBY_ID}`)).toBeUndefined()
    })

    test('returns undefined for an empty string', () => {
      expect(lobbyIdFromPath('')).toBeUndefined()
    })
  })
})
