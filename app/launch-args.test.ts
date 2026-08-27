import { describe, expect, test } from 'vitest'
import { classifyLaunchArgs, MAX_DEEP_LINK_ARG_LENGTH } from './launch-args'

const SCHEME = 'shieldbattery'
const LOBBY_ID = 'AbCdEfGhIjKlMnOpQrStUv'

describe('classifyLaunchArgs', () => {
  test('classifies replay paths and skips flags', () => {
    const result = classifyLaunchArgs(['--hidden', 'game.rep', 'C:\\replays\\Other.REP'], SCHEME)
    expect(result.replayPaths).toEqual(['game.rep', 'C:\\replays\\Other.REP'])
    expect(result.deepLinkLobbyId).toBeUndefined()
  })

  test('parses a deep link to an allowlisted lobby route', () => {
    const result = classifyLaunchArgs([`${SCHEME}://lobbies/${LOBBY_ID}/some-slug`], SCHEME)
    expect(result.deepLinkLobbyId).toBe(LOBBY_ID)
    expect(result.replayPaths).toEqual([])
  })

  test('accepts a scheme in any case', () => {
    const result = classifyLaunchArgs([`SHIELDBATTERY://lobbies/${LOBBY_ID}`], SCHEME)
    expect(result.deepLinkLobbyId).toBe(LOBBY_ID)
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
    expect(result.deepLinkLobbyId).toBe(LOBBY_ID)
  })

  test('drops links for a different channel scheme', () => {
    const result = classifyLaunchArgs([`shieldbattery-staging://lobbies/${LOBBY_ID}`], SCHEME)
    expect(result.deepLinkLobbyId).toBeUndefined()
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
    expect(result.deepLinkLobbyId).toBeUndefined()
    expect(result.replayPaths).toEqual([])
  })

  test('drops over-length deep link args unparsed', () => {
    const padded = `${SCHEME}://lobbies/${LOBBY_ID}/${'a'.repeat(MAX_DEEP_LINK_ARG_LENGTH)}`
    const result = classifyLaunchArgs([padded], SCHEME)
    expect(result.deepLinkLobbyId).toBeUndefined()
  })

  test('the newest valid deep link wins', () => {
    const otherId = 'VuTsRqPoNmLkJiHgFeDcBa'
    const result = classifyLaunchArgs(
      [`${SCHEME}://lobbies/${LOBBY_ID}`, `${SCHEME}://lobbies/${otherId}`],
      SCHEME,
    )
    expect(result.deepLinkLobbyId).toBe(otherId)
  })
})
