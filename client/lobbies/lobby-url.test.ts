import { describe, expect, test } from 'vitest'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { PathObject } from '../navigation/routing'
import { navigateToLobby, urlForLobby } from './lobby-url'

const LOBBY_ID = 'AbCdEfGhIjKlMnOpQrStUv' as SbLobbyId

describe('lobbies/lobby-url', () => {
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
