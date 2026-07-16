import { Immutable } from 'immer'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ReadonlyDeep } from 'type-fest'
import { GameConfigPlayer } from '../../common/games/configuration'
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

export function GamePlayersDisplay({
  game,
  forUserId,
  showTeamLabels = true,
  className,
}: {
  game: ReadonlyDeep<GameRecordJson>
  forUserId?: SbUserId
  showTeamLabels?: boolean
  className?: string
}) {
  const { t } = useTranslation()

  const players = useAppSelector(usePlayersSelector(game), areUsersEqual)
  const playersMapping = useMemo(
    () => new Map<SbUserId, SbUser>(players.map(p => [p.id, p])),
    [players],
  )

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
        : (playersMapping.get(player.id)?.name ?? t('game.playerName.unknown', 'Unknown player')),
    }
  }

  // TODO(2Pac): Handle game types which can have more than two teams
  let teams: ReadonlyArray<ReadonlyArray<PlayerTeamsDisplayPlayer>>
  let teamLabels: ReadonlyArray<string> | undefined

  if (game.config.gameType === 'topVBottom') {
    // Sort the teams so that the team with the user whose profile this is being displayed on comes
    // first and keeps the teams in consistent order. This is mostly helpful when there are a lot of
    // games with the same teams one after another.
    const sortedTeams = game.config.teams.toSorted((a, b) => {
      if (forUserId) {
        if (a.some(p => p.id === forUserId)) {
          return -1
        } else if (b.some(p => p.id === forUserId)) {
          return 1
        }
      }

      // When no forUserId (e.g. public games page), sort teams by first player name for consistency
      const aFirstName = a[0] ? (playersMapping.get(a[0].id)?.name ?? '') : ''
      const bFirstName = b[0] ? (playersMapping.get(b[0].id)?.name ?? '') : ''
      return aFirstName.localeCompare(bFirstName)
    })
    const [teamTop, teamBottom] = sortedTeams

    const mapTeam = (team: ReadonlyArray<GameConfigPlayer>) => {
      return team
        .toSorted((a, b) => {
          const aName = playersMapping.get(a.id)?.name
          const bName = playersMapping.get(b.id)?.name

          if (!aName) {
            return 1
          } else if (!bName) {
            return -1
          }

          return aName.localeCompare(bName)
        })
        .map(toDisplayPlayer)
    }

    teams = [mapTeam(teamTop), mapTeam(teamBottom)]

    if (showTeamLabels) {
      teamLabels = [t('game.teamName.top', 'Top'), t('game.teamName.bottom', 'Bottom')]
    }
  } else {
    // TODO(tec27): Handle UMS game types with 2 teams? Always add team labels for 1v1?

    const sortedPlayers = game.config.teams.flat().toSorted((a, b) => {
      // Sort the players so that the player whose profile this is being displayed on comes first
      // and all the rest are alphabetically sorted.
      if (a.id === forUserId) {
        return -1
      } else if (b.id === forUserId) {
        return 1
      }

      const aName = playersMapping.get(a.id)?.name
      const bName = playersMapping.get(b.id)?.name

      if (!aName) {
        return 1
      } else if (!bName) {
        return -1
      }

      return aName.localeCompare(bName)
    })

    const firstTeam: PlayerTeamsDisplayPlayer[] = []
    const secondTeam: PlayerTeamsDisplayPlayer[] = []

    for (const player of sortedPlayers) {
      const displayPlayer = toDisplayPlayer(player)

      if (firstTeam.length === secondTeam.length) {
        firstTeam.push(displayPlayer)
      } else {
        secondTeam.push(displayPlayer)
      }
    }

    teams = [firstTeam, secondTeam]
  }

  return <PlayerTeamsDisplay teams={teams} teamLabels={teamLabels} className={className} />
}
