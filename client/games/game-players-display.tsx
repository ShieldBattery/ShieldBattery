import { Immutable } from 'immer'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { GameConfigPlayer } from '../../common/games/configuration'
import { GameRecordJson } from '../../common/games/games'
import { RaceChar } from '../../common/races'
import { SbUser } from '../../common/users/sb-user'
import { SbUserId } from '../../common/users/sb-user-id'
import { RaceIcon } from '../lobbies/race-icon'
import { useAppSelector } from '../redux-hooks'
import { RootState } from '../root-reducer'
import { labelMedium, singleLine, titleSmall } from '../styles/typography'

const GamePreviewPlayers = styled.div`
  display: flex;
  gap: 16px;
`

const GamePreviewTeam = styled.div`
  min-width: 0;
  width: calc(50% - 8px);

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const GamePreviewTeamOverline = styled.div`
  ${labelMedium};
  ${singleLine};

  color: var(--theme-on-surface-variant);
`

const GamePreviewPlayerContainer = styled.div`
  height: 20px;

  display: flex;
  align-items: center;
`

const GamePreviewPlayerName = styled.span`
  ${titleSmall};
  ${singleLine};
`

const GamePreviewPlayerRaceRoot = styled.div`
  position: relative;
  width: auto;
  height: 20px;
  margin-right: 4px;
`

const GamePreviewPlayerAssignedRace = styled(RaceIcon)`
  width: auto;
  height: 100%;
  aspect-ratio: 1;
`

const GamePreviewPlayerRandomIcon = styled(RaceIcon)`
  position: absolute;
  /*
    NOTE(tec27): For reasons I don't fully understand, 0 positions this at a place where it is
    clipped by the parent element.
  */
  bottom: 2px;
  right: 0;

  && {
    width: 12px;
    height: 12px;
  }

  & > * {
    text-shadow: 0 0 2px rgba(0, 0, 0, 0.7);
  }
`

interface GamePreviewPlayerRaceProps {
  race: RaceChar
  isRandom: boolean
}

function GamePreviewPlayerRace({ race, isRandom }: GamePreviewPlayerRaceProps) {
  return (
    <GamePreviewPlayerRaceRoot>
      <GamePreviewPlayerAssignedRace race={race} />
      {isRandom && race !== 'r' ? <GamePreviewPlayerRandomIcon race={'r'} /> : null}
    </GamePreviewPlayerRaceRoot>
  )
}

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
    return new Map(results ?? [])
  }, [results])

  // TODO(2Pac): Handle game types which can have more than two teams
  let firstTeamElems: React.ReactNode[] = []
  let secondTeamElems: React.ReactNode[] = []

  if (game.config.gameType === 'topVBottom') {
    // Sort the teams so that the team with the user whose profile this is being displayed on comes
    // first and keeps the teams in consistent order. This is mostly helpful when there are a lot of
    // games with the same teams one after another.
    const sortedTeams = game.config.teams.toSorted((a, b) => {
      if (a.some(p => p.id === forUserId)) {
        return -1
      } else if (b.some(p => p.id === forUserId)) {
        return 1
      }

      // TODO(2Pac): Figure out some way to keep consistent order of teams even if we're not showing
      // this in a specific user profile (e.g. on public games page).
      return 0
    })
    const [teamTop, teamBottom] = sortedTeams

    const mapTeamToElems = (team: ReadonlyArray<GameConfigPlayer>) => {
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
        .map((player, i) => {
          const result = player.isComputer ? undefined : resultsById.get(player.id)
          return (
            <GamePreviewPlayerContainer key={`player-${i}`}>
              <GamePreviewPlayerRace
                race={result?.race ?? player.race}
                isRandom={player.race === 'r'}
              />
              <GamePreviewPlayerName>
                {player.isComputer
                  ? t('game.playerName.computer', 'Computer')
                  : (playersMapping.get(player.id)?.name ??
                    t('game.playerName.unknown', 'Unknown player'))}
              </GamePreviewPlayerName>
            </GamePreviewPlayerContainer>
          )
        })
    }

    firstTeamElems = mapTeamToElems(teamTop)
    secondTeamElems = mapTeamToElems(teamBottom)

    if (showTeamLabels) {
      firstTeamElems.unshift(
        <GamePreviewTeamOverline key={'team-top'}>
          {t('game.teamName.top', 'Top')}
        </GamePreviewTeamOverline>,
      )
      secondTeamElems.unshift(
        <GamePreviewTeamOverline key={'team-bottom'}>
          {t('game.teamName.bottom', 'Bottom')}
        </GamePreviewTeamOverline>,
      )
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

    for (const [i, player] of sortedPlayers.entries()) {
      const result = player.isComputer ? undefined : resultsById.get(player.id)
      const playerElem = (
        <GamePreviewPlayerContainer key={`player-${i}`}>
          <GamePreviewPlayerRace
            race={result?.race ?? player.race}
            isRandom={player.race === 'r'}
          />
          <GamePreviewPlayerName>
            {player.isComputer
              ? t('game.playerName.computer', 'Computer')
              : (playersMapping.get(player.id)?.name ??
                t('game.playerName.unknown', 'Unknown player'))}
          </GamePreviewPlayerName>
        </GamePreviewPlayerContainer>
      )

      if (firstTeamElems.length === secondTeamElems.length) {
        firstTeamElems.push(playerElem)
      } else {
        secondTeamElems.push(playerElem)
      }
    }
  }

  return (
    <GamePreviewPlayers className={className}>
      <GamePreviewTeam>{firstTeamElems}</GamePreviewTeam>
      <GamePreviewTeam>{secondTeamElems}</GamePreviewTeam>
    </GamePreviewPlayers>
  )
}
