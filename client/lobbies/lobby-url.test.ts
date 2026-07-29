import { describe, expect, test, vi } from 'vitest'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { PathObject } from '../navigation/routing'
import { lobbySlug, navigateToLobby, urlForLobby } from './lobby-url'

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
  })

  describe('urlForLobby', () => {
    test('includes a slugified name when provided', () => {
      expect(urlForLobby(LOBBY_ID, 'My Cool Lobby 2')).toBe(`/lobbies/${LOBBY_ID}/my-cool-lobby-2`)
    })

    test('uses the "_" placeholder when no name is provided', () => {
      expect(urlForLobby(LOBBY_ID)).toBe(`/lobbies/${LOBBY_ID}/_`)
    })
  })

  describe('navigateToLobby', () => {
    test('passes the built URL to the provided transition function', () => {
      const calls: Array<string | PathObject> = []
      navigateToLobby(LOBBY_ID, 'My Cool Lobby 2', url => {
        calls.push(url)
      })

      expect(calls).toEqual([urlForLobby(LOBBY_ID, 'My Cool Lobby 2')])
    })
  })
})
