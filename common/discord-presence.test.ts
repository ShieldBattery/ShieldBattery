import { describe, expect, test } from 'vitest'
import { makeLobbyJoinSecret, parseDiscordJoinSecret } from './discord-presence'
import { makeSbLobbyId } from './lobbies/sb-lobby-id'

const LOBBY_ID = makeSbLobbyId('Ek0xQmQzSXu9vMSq1Ya2Ww')

describe('common/discord-presence', () => {
  test("a lobby's join secret parses back into the lobby", () => {
    expect(parseDiscordJoinSecret(makeLobbyJoinSecret(LOBBY_ID))).toEqual({
      type: 'lobby',
      lobbyId: LOBBY_ID,
    })
  })

  test('a secret without the lobby prefix is ignored', () => {
    expect(parseDiscordJoinSecret(LOBBY_ID)).toBeUndefined()
    expect(parseDiscordJoinSecret(`game:${LOBBY_ID}`)).toBeUndefined()
  })

  test("a secret whose lobby id isn't one the server makes is ignored", () => {
    expect(parseDiscordJoinSecret('lobby:')).toBeUndefined()
    expect(parseDiscordJoinSecret('lobby:../../settings')).toBeUndefined()
    expect(parseDiscordJoinSecret(`lobby:${LOBBY_ID}x`)).toBeUndefined()
  })
})
