import { ReadonlyDeep } from 'type-fest'
import { isTeamType } from '../../common/games/game-type'
import { GameRecordJson } from '../../common/games/games'
import { RaceChar } from '../../common/races'
import { SbUserId } from '../../common/users/sb-user-id'

/**
 * The races each side of a game played, with the side `selfId` was on first. Prefers the races
 * players ended up with over the ones they were configured with, so Random shows what it became.
 */
export function getPostGameMatchup(
  game: ReadonlyDeep<GameRecordJson>,
  selfId: SbUserId | undefined,
): RaceChar[][] {
  const resultsById = new Map(game.results)
  // A game without teams still lists its players together, but each of them is their own side.
  const sides = isTeamType(game.config.gameType)
    ? game.config.teams
    : game.config.teams.flat().map(player => [player])

  const isSelfSide = (side: (typeof sides)[number]) =>
    side.some(p => !p.isComputer && p.id === selfId)

  return [...sides.filter(isSelfSide), ...sides.filter(side => !isSelfSide(side))].map(side =>
    side.map(p => (p.isComputer ? undefined : resultsById.get(p.id)?.race) ?? p.race),
  )
}
