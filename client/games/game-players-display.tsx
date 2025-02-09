import { Immutable } from 'immer'
import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { GameRecordJson } from '../../common/games/games'
import { RaceChar } from '../../common/races'
import { SbUser } from '../../common/users/sb-user'
import { RaceIcon } from '../lobbies/race-icon'
import { useAppSelector } from '../redux-hooks'
import { RootState } from '../root-reducer'
import { colorTextSecondary } from '../styles/colors'
import { body2, overline, singleLine } from '../styles/typography'

const GamePreviewPlayers = styled.div`
  column-count: 2;
  column-gap: 16px;
  text-align: start;
`

const GamePreviewTeamOverline = styled.div`
  ${overline};
  ${singleLine};

  color: ${colorTextSecondary};
  margin-bottom: 8px;
`

const GamePreviewPlayer = styled.div`
  ${body2};
  ${singleLine};

  height: 20px;

  display: flex;
  align-items: center;

  margin-bottom: 8px;
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
  showTeamLabels = true,
  className,
}: {
  game: Immutable<GameRecordJson>
  showTeamLabels?: boolean
  className?: string
}) {
  const { t } = useTranslation()

  const players = useAppSelector(usePlayersSelector(game), areUsersEqual)
  const playersMapping = useMemo(
    () => new Map<number, SbUser>(players.map(p => [p.id, p])),
    [players],
  )

  const resultsById = useMemo(() => {
    return new Map(game?.results ?? [])
  }, [game?.results])

  const playerElems: React.ReactNode[] = []
  if (game.config.gameType === 'topVBottom') {
    if (showTeamLabels) {
      playerElems.push(
        <GamePreviewTeamOverline key={'team-top'}>
          {t('game.teamName.top', 'Top')}
        </GamePreviewTeamOverline>,
      )
    }
    const [teamTop, teamBottom] = game.config.teams
    const teamDiff = teamTop.length - teamBottom.length
    playerElems.push(
      ...teamTop.map((p, i) => {
        const result = p.isComputer ? undefined : resultsById.get(p.id)
        return (
          <GamePreviewPlayer key={`team-top-${i}`}>
            <GamePreviewPlayerRace race={result?.race ?? p.race} isRandom={p.race === 'r'} />
            <span>
              {p.isComputer
                ? t('game.playerName.computer', 'Computer')
                : (playersMapping.get(p.id)?.name ??
                  t('game.playerName.unknown', 'Unknown player'))}
            </span>
          </GamePreviewPlayer>
        )
      }),
    )

    // If teamBottom has more players, render placeholders for teamTop.
    if (teamDiff < 0) {
      for (let i = 0; i < Math.abs(teamDiff); i++) {
        playerElems.push(<GamePreviewPlayer key={`placeholder-${i}`} />)
      }
    }

    if (showTeamLabels) {
      playerElems.push(
        <GamePreviewTeamOverline key={'team-bottom'}>
          {t('game.teamName.bottom', 'Bottom')}
        </GamePreviewTeamOverline>,
      )
    }
    playerElems.push(
      ...teamBottom.map((p, i) => {
        const result = p.isComputer ? undefined : resultsById.get(p.id)
        return (
          <GamePreviewPlayer key={`team-bottom-${i}`}>
            <GamePreviewPlayerRace race={result?.race ?? p.race} isRandom={p.race === 'r'} />
            <span>
              {p.isComputer
                ? t('game.playerName.computer', 'Computer')
                : (playersMapping.get(p.id)?.name ??
                  t('game.playerName.unknown', 'Unknown player'))}
            </span>
          </GamePreviewPlayer>
        )
      }),
    )

    // If teamTop has more players, render placeholders for teamBottom.
    if (teamDiff > 0) {
      for (let i = 0; i < teamDiff; i++) {
        playerElems.push(<GamePreviewPlayer key={`placeholder-${i}`} />)
      }
    }
  } else {
    // TODO(tec27): Handle UMS game types with 2 teams? Always add team labels for 1v1?
    playerElems.push(
      ...game.config.teams.flatMap((team, i) =>
        team.map((p, j) => {
          const result = p.isComputer ? undefined : resultsById.get(p.id)
          return (
            <GamePreviewPlayer key={`team-${i}-${j}`}>
              <GamePreviewPlayerRace race={result?.race ?? p.race} isRandom={p.race === 'r'} />
              <span>
                {p.isComputer
                  ? t('game.playerName.computer', 'Computer')
                  : (playersMapping.get(p.id)?.name ??
                    t('game.playerName.unknown', 'Unknown player'))}
              </span>
            </GamePreviewPlayer>
          )
        }),
      ),
    )
  }

  return <GamePreviewPlayers className={className}>{playerElems}</GamePreviewPlayers>
}
