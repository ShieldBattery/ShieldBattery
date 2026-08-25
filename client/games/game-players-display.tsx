import { Immutable } from 'immer'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ReadonlyDeep } from 'type-fest'
import { GameConfigPlayer } from '../../common/games/configuration'
import { GameType } from '../../common/games/game-type'
import { GameRecordJson } from '../../common/games/games'
import { ReconciledPlayerResult } from '../../common/games/results'
import { SbUser } from '../../common/users/sb-user'
import { SbUserId } from '../../common/users/sb-user-id'
import { useAppSelector } from '../redux-hooks'
import { RootState } from '../root-reducer'
import { PlayerTeamsDisplay, PlayerTeamsDisplayPlayer } from './player-teams-display'

function usePlayersSelector(game: Immutable<GameRecordJson>) {
  return useCallback(
    (state: RootState): ReadonlyArray<SbUser> => {
      if (!game) {
        return []
      }

      const onlyHumans = game.config.teams.flat().filter(p => !p.isComputer)
      return onlyHumans.map(p => state.users.byId.get(p.id)!)
    },
    [game],
  )
}

function areUsersEqual(a: ReadonlyArray<SbUser>, b: ReadonlyArray<SbUser>): boolean {
  if (a.length !== b.length) {
    return false
  }

  for (let i = 0; i < a.length; i++) {
    const aUser = a[i]
    const bUser = b[i]
    if (aUser.id !== bUser.id || aUser.name !== bUser.name) {
      return false
    }
  }

  return true
}

/**
 * Resolves the display names (from the users store) of every human player in a game, keyed by
 * their user ID. Computer players are never present in the result.
 */
export function useGamePlayerNames(
  game: ReadonlyDeep<GameRecordJson>,
): ReadonlyMap<SbUserId, string> {
  const players = useAppSelector(usePlayersSelector(game), areUsersEqual)
  return new Map(players.map(p => [p.id, p.name]))
}

// TODO(2Pac): Handle game types which can have more than two teams
/**
 * Orders a game's teams the same way they're shown in `GamePlayersDisplay`, so a row's rendered
 * player order and anything derived from "the first-listed side" (e.g. a result label) can never
 * diverge.
 *
 * For `topVBottom`, the two teams are ordered with `forUserId`'s team first (falling back to
 * alphabetical by first player name when absent or when there's no `forUserId`), then each team's
 * own members are sorted alphabetically. Otherwise, every player is flattened into one alphabetical
 * ordering (`forUserId` first) and split into two roughly-even sides by alternating players into
 * them — the "first side" here is the even-indexed half of that single sorted list, not a real team.
 *
 * Players with no resolved name (absent from `nameById`, e.g. computer players) sort last within
 * whatever grouping they fall into.
 */
export function getOrderedTeams(
  teams: ReadonlyArray<ReadonlyArray<GameConfigPlayer>>,
  gameType: GameType,
  nameById: ReadonlyMap<SbUserId, string>,
  forUserId?: SbUserId,
): ReadonlyArray<ReadonlyArray<GameConfigPlayer>> {
  if (gameType === GameType.TopVsBottom) {
    // Sort the teams so that the team with the user whose profile this is being displayed on comes
    // first and keeps the teams in consistent order. This is mostly helpful when there are a lot of
    // games with the same teams one after another.
    const sortedTeams = teams.toSorted((a, b) => {
      if (forUserId) {
        if (a.some(p => p.id === forUserId)) {
          return -1
        } else if (b.some(p => p.id === forUserId)) {
          return 1
        }
      }

      // When no forUserId (e.g. public games page), sort teams by first player name for consistency
      const aFirstName = a[0] ? (nameById.get(a[0].id) ?? '') : ''
      const bFirstName = b[0] ? (nameById.get(b[0].id) ?? '') : ''
      return aFirstName.localeCompare(bFirstName)
    })
    const [teamTop, teamBottom] = sortedTeams

    const sortTeam = (team: ReadonlyArray<GameConfigPlayer>) =>
      team.toSorted((a, b) => {
        const aName = nameById.get(a.id)
        const bName = nameById.get(b.id)

        if (!aName) {
          return 1
        } else if (!bName) {
          return -1
        }

        return aName.localeCompare(bName)
      })

    return [sortTeam(teamTop), sortTeam(teamBottom)]
  }

  const sortedPlayers = teams.flat().toSorted((a, b) => {
    // Sort the players so that the player whose profile this is being displayed on comes first
    // and all the rest are alphabetically sorted.
    if (a.id === forUserId) {
      return -1
    } else if (b.id === forUserId) {
      return 1
    }

    const aName = nameById.get(a.id)
    const bName = nameById.get(b.id)

    if (!aName) {
      return 1
    } else if (!bName) {
      return -1
    }

    return aName.localeCompare(bName)
  })

  const firstTeam: GameConfigPlayer[] = []
  const secondTeam: GameConfigPlayer[] = []

  for (const player of sortedPlayers) {
    if (firstTeam.length === secondTeam.length) {
      firstTeam.push(player)
    } else {
      secondTeam.push(player)
    }
  }

  return [firstTeam, secondTeam]
}

export function GamePlayersDisplay({
  game,
  forUserId,
  showTeamLabels = true,
  interactiveNames = false,
  className,
}: {
  game: ReadonlyDeep<GameRecordJson>
  forUserId?: SbUserId
  showTeamLabels?: boolean
  /**
   * When true, human players' names render as store-connected, interactive usernames (clicking
   * opens the profile overlay, right-clicking opens the user context menu) instead of plain text.
   * Computer opponents always render as plain text.
   */
  interactiveNames?: boolean
  className?: string
}) {
  const { t } = useTranslation()

  const players = useAppSelector(usePlayersSelector(game), areUsersEqual)
  const nameById = new Map<SbUserId, string>(players.map(p => [p.id, p.name]))

  const results = game?.results
  const resultsById = useMemo(() => {
    // Guard against legacy rows where `results` is a non-array (e.g. an empty object `{}`); a
    // non-iterable value would make `new Map(...)` throw and crash the whole list. The explicit
    // generic is needed because `Array.isArray` widens the `ReadonlyDeep` entries and would
    // otherwise collapse the map's value type to `{}`.
    return new Map<SbUserId, ReconciledPlayerResult>(Array.isArray(results) ? results : [])
  }, [results])

  const toDisplayPlayer = (player: GameConfigPlayer): PlayerTeamsDisplayPlayer => {
    const result = player.isComputer ? undefined : resultsById.get(player.id)
    return {
      race: result?.race ?? player.race,
      isRandom: player.race === 'r',
      name: player.isComputer
        ? t('game.playerName.computer', 'Computer')
        : (nameById.get(player.id) ?? t('game.playerName.unknown', 'Unknown player')),
      userId: interactiveNames && !player.isComputer ? player.id : undefined,
    }
  }

  const orderedTeams = getOrderedTeams(game.config.teams, game.config.gameType, nameById, forUserId)
  const teams = orderedTeams.map(team => team.map(toDisplayPlayer))

  // TODO(tec27): Handle UMS game types with 2 teams? Always add team labels for 1v1?
  const teamLabels: ReadonlyArray<string> | undefined =
    game.config.gameType === GameType.TopVsBottom && showTeamLabels
      ? [t('game.teamName.top', 'Top'), t('game.teamName.bottom', 'Bottom')]
      : undefined

  return <PlayerTeamsDisplay teams={teams} teamLabels={teamLabels} className={className} />
}
