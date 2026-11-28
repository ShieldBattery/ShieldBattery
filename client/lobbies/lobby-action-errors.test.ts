import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { LobbyServiceErrorCode } from '../../common/lobbies/lobby-network'
import { FetchError } from '../network/fetch-errors'
import { lobbyActionErrorMessage } from './lobby-action-errors'

/** Fills a default value's `{{placeholders}}` from its options, the way i18next does. */
const t = ((_key: string, options?: string | Record<string, unknown>) => {
  if (typeof options === 'string') {
    return options
  }
  const template = String(options?.defaultValue ?? '')
  return template.replace(/{{(\w+)}}/g, (_match, name: string) => String(options?.[name]))
}) as unknown as TFunction

function refusal(body: object) {
  return new FetchError(new Response(null, { status: 409 }), JSON.stringify(body))
}

describe('lobbies/lobby-action-errors', () => {
  test('says why a correction of a series was refused', () => {
    expect(lobbyActionErrorMessage(refusal({ code: LobbyServiceErrorCode.NoBestOf }), t)).toBe(
      'This lobby has not played a series',
    )
    expect(
      lobbyActionErrorMessage(refusal({ code: LobbyServiceErrorCode.BestOfResultNotFound }), t),
    ).toBe('That result is no longer part of the series')
    expect(lobbyActionErrorMessage(refusal({ code: LobbyServiceErrorCode.InvalidBestOf }), t)).toBe(
      "The series can't be set up that way. Its players have to be in the lobby, and it can count at most 99 games.",
    )
  })

  describe('a start refused for the best-of roster', () => {
    const code = LobbyServiceErrorCode.BestOfRosterMismatch

    test('names the side with nobody seated by its name', () => {
      const err = refusal({ code, unseatedSides: [1], extra: [], mixedTeams: false })

      expect(lobbyActionErrorMessage(err, t, { sideNames: [null, 'Ironclad'] })).toBe(
        'Ironclad has nobody seated',
      )
    })

    test('names a side with no name by its number', () => {
      const err = refusal({ code, unseatedSides: [1, 0], extra: [], mixedTeams: false })

      expect(lobbyActionErrorMessage(err, t, { sideNames: ['Nexus', null] })).toBe(
        'Team 2 has nobody seated',
      )
      expect(lobbyActionErrorMessage(err, t, {})).toBe('Team 2 has nobody seated')
      // Without the series at hand, the side is still named by its number
      expect(lobbyActionErrorMessage(err, t)).toBe('Team 2 has nobody seated')
    })

    test('falls back to the general message when no side is unseated or the body says nothing', () => {
      const general = "The seated players don't match the series' sides"

      expect(
        lobbyActionErrorMessage(
          refusal({ code, unseatedSides: [], extra: [7], mixedTeams: false }),
          t,
          { sideNames: ['Nexus', 'Ironclad'] },
        ),
      ).toBe(general)
      expect(lobbyActionErrorMessage(refusal({ code }), t)).toBe(general)
      expect(lobbyActionErrorMessage(refusal({ code, unseatedSides: [5] }), t)).toBe(general)
      expect(lobbyActionErrorMessage(refusal({ code, unseatedSides: 'one' }), t)).toBe(general)
    })
  })
})
