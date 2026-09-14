import { describe, expect, test } from 'vitest'
import { ReconciledResult } from '../games/results'
import { makeSbMapId } from '../maps'
import { makeSbUserId, SbUserId } from '../users/sb-user-id'
import { LobbySeriesGameJson, LobbySeriesTeamJson } from './lobby-network'
import { findSeriesGameWinner, getWinsByUser } from './lobby-series'

const MAP_ID = makeSbMapId('big-game-hunters')

const ALICE = makeSbUserId(1)
const BOB = makeSbUserId(2)
const CARA = makeSbUserId(3)
const DAN = makeSbUserId(4)

/** A side holding the given people, all playing random. */
function team(teamId: number, userIds: SbUserId[], name?: string): LobbySeriesTeamJson {
  return {
    teamId,
    ...(name !== undefined ? { name } : {}),
    players: userIds.map(userId => ({ type: 'human', userId, race: 'r' })),
  }
}

/** A game of a lobby's series, settled with the given outcomes unless they're left out. */
function game(
  teams: LobbySeriesTeamJson[],
  outcomes?: Array<[SbUserId, ReconciledResult]>,
): LobbySeriesGameJson {
  return {
    gameId: 'test-game-id',
    mapId: MAP_ID,
    teams,
    ...(outcomes
      ? {
          result: {
            outcomes: outcomes.map(([userId, result]) => ({ userId, result })),
            durationMs: 480000,
          },
        }
      : {}),
  }
}

describe('lobbies/lobby-series', () => {
  describe('findSeriesGameWinner', () => {
    test('names the player who won a melee game', () => {
      const winner = findSeriesGameWinner(
        game(
          [team(0, [ALICE, BOB])],
          [
            [ALICE, 'win'],
            [BOB, 'loss'],
          ],
        ),
      )

      expect(winner).toEqual({ kind: 'player', userId: ALICE })
    })

    test('a melee game the only human lost has no winner', () => {
      // The computer that beat them reports no result of its own
      const winner = findSeriesGameWinner(
        game(
          [
            {
              teamId: 0,
              players: [
                { type: 'human', userId: ALICE, race: 'r' },
                { type: 'computer', race: 't' },
              ],
            },
          ],
          [[ALICE, 'loss']],
        ),
      )

      expect(winner).toBeUndefined()
    })

    test('names the one player who won a free-for-all', () => {
      const winner = findSeriesGameWinner(
        game(
          [team(0, [ALICE, BOB, CARA])],
          [
            [ALICE, 'loss'],
            [BOB, 'win'],
            [CARA, 'loss'],
          ],
        ),
      )

      expect(winner).toEqual({ kind: 'player', userId: BOB })
    })

    test('names the side that won a game with two of them', () => {
      const winner = findSeriesGameWinner(
        game(
          [team(1, [ALICE, BOB], 'Top'), team(2, [CARA, DAN], 'Bottom')],
          [
            [ALICE, 'loss'],
            [BOB, 'loss'],
            [CARA, 'win'],
            [DAN, 'win'],
          ],
        ),
      )

      expect(winner).toEqual({ kind: 'team', teamId: 2, name: 'Bottom' })
    })

    test('winners on both sides leave the winner unknown', () => {
      const winner = findSeriesGameWinner(
        game(
          [team(1, [ALICE, BOB], 'Top'), team(2, [CARA, DAN], 'Bottom')],
          [
            [ALICE, 'win'],
            [CARA, 'win'],
          ],
        ),
      )

      expect(winner).toBeUndefined()
    })

    test('a winner who sits on no side of the roster leaves the winner unknown', () => {
      const winner = findSeriesGameWinner(
        game([team(1, [ALICE], 'Top'), team(2, [BOB], 'Bottom')], [[CARA, 'win']]),
      )

      expect(winner).toBeUndefined()
    })

    test('a game whose results have not settled has no winner', () => {
      expect(
        findSeriesGameWinner(game([team(1, [ALICE], 'Top'), team(2, [BOB], 'Bottom')])),
      ).toBeUndefined()
    })

    test('a game everyone drew has no winner', () => {
      const winner = findSeriesGameWinner(
        game(
          [team(1, [ALICE], 'Top'), team(2, [BOB], 'Bottom')],
          [
            [ALICE, 'draw'],
            [BOB, 'draw'],
          ],
        ),
      )

      expect(winner).toBeUndefined()
    })
  })

  describe('getWinsByUser', () => {
    test('counts every settled win, on sides and on their own alike', () => {
      const wins = getWinsByUser([
        game(
          [team(1, [ALICE, BOB], 'Top'), team(2, [CARA], 'Bottom')],
          [
            [ALICE, 'win'],
            [BOB, 'win'],
            [CARA, 'loss'],
          ],
        ),
        game(
          [team(0, [ALICE, CARA])],
          [
            [ALICE, 'loss'],
            [CARA, 'win'],
          ],
        ),
        // Never settled, so it counts for nobody
        game([team(0, [ALICE, CARA])]),
        game(
          [team(0, [ALICE, CARA])],
          [
            [ALICE, 'draw'],
            [CARA, 'draw'],
          ],
        ),
      ])

      expect(wins).toEqual(
        new Map([
          [ALICE, 1],
          [BOB, 1],
          [CARA, 1],
        ]),
      )
    })

    test('a series nobody has won yet tallies nothing', () => {
      expect(getWinsByUser([game([team(0, [ALICE, BOB])])])).toEqual(new Map())
    })
  })
})
