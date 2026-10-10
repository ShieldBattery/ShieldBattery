import { describe, expect, test } from 'vitest'
import { encodePrettyId } from '../common/pretty-id'
import { classifyLaunchArgs, MAX_DEEP_LINK_ARG_LENGTH } from './launch-args'

const SCHEME = 'shieldbattery'
const LOBBY_ID = 'AbCdEfGhIjKlMnOpQrStUv'
const GAME_ID = '0190a7e2-3c4d-7e8f-9a0b-1c2d3e4f5a6b'
const GAME_ROUTE_ID = encodePrettyId(GAME_ID)

describe('classifyLaunchArgs', () => {
  test('classifies replay paths and skips flags', () => {
    const result = classifyLaunchArgs(['--hidden', 'game.rep', 'C:\\replays\\Other.REP'], SCHEME)
    expect(result.replayPaths).toEqual(['game.rep', 'C:\\replays\\Other.REP'])
    expect(result.deepLink).toBeUndefined()
  })

  test('parses a deep link to an allowlisted lobby route', () => {
    const result = classifyLaunchArgs([`${SCHEME}://lobbies/${LOBBY_ID}/some-slug`], SCHEME)
    expect(result.deepLink).toEqual({ type: 'lobby', lobbyId: LOBBY_ID })
    expect(result.replayPaths).toEqual([])
  })

  test('accepts a scheme in any case', () => {
    const result = classifyLaunchArgs([`SHIELDBATTERY://lobbies/${LOBBY_ID}`], SCHEME)
    expect(result.deepLink).toEqual({ type: 'lobby', lobbyId: LOBBY_ID })
  })

  test('never treats a URI as a replay path, even with a .rep tail', () => {
    const result = classifyLaunchArgs(
      [
        `${SCHEME}://lobbies/${LOBBY_ID}/slug.rep`,
        'https://example.org/download/thing.rep',
        `${SCHEME}://..\\..\\traversal.rep`,
      ],
      SCHEME,
    )
    expect(result.replayPaths).toEqual([])
    expect(result.deepLink).toEqual({ type: 'lobby', lobbyId: LOBBY_ID })
  })

  test('drops links for a different channel scheme', () => {
    const result = classifyLaunchArgs([`shieldbattery-staging://lobbies/${LOBBY_ID}`], SCHEME)
    expect(result.deepLink).toBeUndefined()
  })

  test('drops non-lobby routes, malformed ids, and unparseable URIs', () => {
    const result = classifyLaunchArgs(
      [
        `${SCHEME}://settings/app`,
        `${SCHEME}://lobbies/not-a-valid-id`,
        `${SCHEME}://lobbies`,
        'not-a-uri://',
      ],
      SCHEME,
    )
    expect(result.deepLink).toBeUndefined()
    expect(result.replayPaths).toEqual([])
  })

  test('drops over-length deep link args unparsed', () => {
    const padded = `${SCHEME}://lobbies/${LOBBY_ID}/${'a'.repeat(MAX_DEEP_LINK_ARG_LENGTH)}`
    const result = classifyLaunchArgs([padded], SCHEME)
    expect(result.deepLink).toBeUndefined()
  })

  test('the newest valid deep link wins', () => {
    const otherId = 'VuTsRqPoNmLkJiHgFeDcBa'
    const result = classifyLaunchArgs(
      [`${SCHEME}://lobbies/${LOBBY_ID}`, `${SCHEME}://lobbies/${otherId}`],
      SCHEME,
    )
    expect(result.deepLink).toEqual({ type: 'lobby', lobbyId: otherId })
  })

  test('parses a deep link to a game, with or without a timestamp', () => {
    expect(classifyLaunchArgs([`${SCHEME}://games/${GAME_ROUTE_ID}`], SCHEME).deepLink).toEqual({
      type: 'game',
      gameId: GAME_ID,
      timestampSeconds: undefined,
    })
    expect(
      classifyLaunchArgs([`${SCHEME}://games/${GAME_ROUTE_ID}/summary?t=12m34s`], SCHEME).deepLink,
    ).toEqual({ type: 'game', gameId: GAME_ID, timestampSeconds: 754 })
  })

  test('ignores a malformed game timestamp but keeps the game', () => {
    const result = classifyLaunchArgs([`${SCHEME}://games/${GAME_ROUTE_ID}?t=soon`], SCHEME)
    expect(result.deepLink).toEqual({ type: 'game', gameId: GAME_ID, timestampSeconds: undefined })
  })

  test('drops game links with malformed ids or extra segments', () => {
    const result = classifyLaunchArgs(
      [
        `${SCHEME}://games/not-a-valid-id`,
        `${SCHEME}://games`,
        `${SCHEME}://games/${GAME_ROUTE_ID}/summary/extra`,
      ],
      SCHEME,
    )
    expect(result.deepLink).toBeUndefined()
  })

  test('the newest valid deep link wins across kinds', () => {
    const result = classifyLaunchArgs(
      [`${SCHEME}://games/${GAME_ROUTE_ID}?t=30`, `${SCHEME}://lobbies/${LOBBY_ID}`],
      SCHEME,
    )
    expect(result.deepLink).toEqual({ type: 'lobby', lobbyId: LOBBY_ID })
  })
})
