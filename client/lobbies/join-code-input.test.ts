import { describe, expect, test } from 'vitest'
import { encodePrettyId } from '../../common/pretty-id'
import { parseJoinCodeInput } from './join-code-input'

// Matches the server origin the client test environment is configured with (see
// `vitest.config.ts`'s `SB_SERVER` define), so https links classify the same way real ones do.
const LOBBY_ID = encodePrettyId('5eed0000-0000-0000-0000-000000000042')

describe('client/lobbies/join-code-input', () => {
  describe('join codes', () => {
    test('accepts a code with its display dash', () => {
      expect(parseJoinCodeInput('BQ4-XM9')).toEqual({ kind: 'code', code: 'BQ4XM9' })
    })

    test('accepts a lower case code', () => {
      expect(parseJoinCodeInput('bq4xm9')).toEqual({ kind: 'code', code: 'BQ4XM9' })
    })

    test('accepts a code with surrounding and interior spaces', () => {
      expect(parseJoinCodeInput(' BQ4 XM9 ')).toEqual({ kind: 'code', code: 'BQ4XM9' })
    })
  })

  describe('lobby URLs', () => {
    test('accepts an https app-origin link with a slug', () => {
      expect(
        parseJoinCodeInput(`https://shieldbattery.net/lobbies/${LOBBY_ID}/my-cool-lobby`),
      ).toEqual({ kind: 'lobbyId', id: LOBBY_ID })
    })

    test('accepts an https app-origin link with no slug', () => {
      expect(parseJoinCodeInput(`https://shieldbattery.net/lobbies/${LOBBY_ID}`)).toEqual({
        kind: 'lobbyId',
        id: LOBBY_ID,
      })
    })

    test('rejects an https link on a foreign origin', () => {
      expect(
        parseJoinCodeInput(`https://example.com/lobbies/${LOBBY_ID}/my-cool-lobby`),
      ).toBeUndefined()
    })

    test('accepts the prod scheme URL', () => {
      expect(parseJoinCodeInput(`shieldbattery://lobbies/${LOBBY_ID}`)).toEqual({
        kind: 'lobbyId',
        id: LOBBY_ID,
      })
    })

    test('accepts a channel-suffixed scheme URL', () => {
      expect(
        parseJoinCodeInput(`shieldbattery-staging://lobbies/${LOBBY_ID}/my-cool-lobby`),
      ).toEqual({
        kind: 'lobbyId',
        id: LOBBY_ID,
      })
    })

    test('accepts a scheme URL in any case', () => {
      expect(parseJoinCodeInput(`SHIELDBATTERY://lobbies/${LOBBY_ID}`)).toEqual({
        kind: 'lobbyId',
        id: LOBBY_ID,
      })
    })

    test('rejects a scheme that merely resembles a registered one', () => {
      expect(parseJoinCodeInput(`shieldbattery-evil://lobbies/${LOBBY_ID}`)).toBeUndefined()
      expect(parseJoinCodeInput(`shieldbatteryx://lobbies/${LOBBY_ID}`)).toBeUndefined()
    })
  })

  describe('bare lobby ids', () => {
    test('accepts a bare pretty id', () => {
      expect(parseJoinCodeInput(LOBBY_ID)).toEqual({ kind: 'lobbyId', id: LOBBY_ID })
    })

    test('accepts a bare pretty id with surrounding whitespace', () => {
      expect(parseJoinCodeInput(`  ${LOBBY_ID}  `)).toEqual({ kind: 'lobbyId', id: LOBBY_ID })
    })
  })

  describe('garbage input', () => {
    test('rejects an empty string', () => {
      expect(parseJoinCodeInput('')).toBeUndefined()
    })

    test('rejects unrelated text', () => {
      expect(parseJoinCodeInput('hello there')).toBeUndefined()
    })

    test('rejects a non-ShieldBattery URL', () => {
      expect(parseJoinCodeInput('https://example.com')).toBeUndefined()
    })

    test('rejects a too-short id-like string', () => {
      expect(parseJoinCodeInput(LOBBY_ID.slice(0, 10))).toBeUndefined()
    })
  })
})
