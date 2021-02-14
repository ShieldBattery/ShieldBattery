import { Immutable } from 'immer'
import { rgba } from 'polished'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { GameRecordJson } from '../../common/games/games'
import { ReconciledResult } from '../../common/games/results'
import { RaceChar } from '../../common/races'
import { SbUser, SbUserId } from '../../common/users/user-info'
import { navigateToGameResults } from '../games/action-creators'
import { RaceIcon } from '../lobbies/race-icon'
import { batchGetMapInfo, openMapPreviewDialog } from '../maps/action-creators'
import { MapThumbnail } from '../maps/map-thumbnail'
import { useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Ripple } from '../material/ripple'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import {
  background700,
  colorNegative,
  colorPositive,
  colorTextFaint,
  colorTextPrimary,
  colorTextSecondary,
} from '../styles/colors'
import { Body1, body2, overline, singleLine, subtitle1 } from '../styles/typography'
import { timeAgo } from '../time/time-ago'

const MatchHistoryRoot = styled.div`
  min-height: 256px;
  margin-bottom: 48px;
  /** 8 + 16px of internal padding in list = 24px */
  padding: 0 24px 0 8px;

  display: flex;
`

const GameList = styled.div`
  margin-right: 8px;
  flex-grow: 1;
  flex-shrink: 1;
`

const EmptyListText = styled.div`
  ${subtitle1};
  color: ${colorTextFaint};
  margin-left: 16px;
`

export interface MiniMatchHistoryProps {
  forUserId: SbUserId
  games: Immutable<GameRecordJson[]>
}

export function MiniMatchHistory({ forUserId, games }: MiniMatchHistoryProps) {
  const [activeGameId, setActiveGameId] = useState(games.length > 0 ? games[0].id : undefined)
  const activeGame = useMemo(() => {
    if (!activeGameId) {
      return undefined
    }

    return games.find(g => g.id === activeGameId)
  }, [activeGameId, games])

  return (
    <MatchHistoryRoot>
      <GameList>
        {games.map((g, i) => (
          <ConnectedGameListEntry
            key={i}
            forUserId={forUserId}
            game={g}
            onSetActive={setActiveGameId}
            active={g.id === activeGameId}
          />
        ))}
        {games.length === 0 ? <EmptyListText>Nothing to see here</EmptyListText> : null}
      </GameList>
      <ConnectedGamePreview game={activeGame}></ConnectedGamePreview>
    </MatchHistoryRoot>
  )
}

const GameListEntryRoot = styled.button<{ $active: boolean }>`
  ${buttonReset};

  width: 100%;
  height: 64px;
  padding: 12px 16px;

  border-radius: 4px;
  text-align: left;

  background-color: ${props => (props.$active ? 'rgba(255, 255, 255, 0.04)' : 'transparent')};

  & + & {
    margin-top: 8px;
  }
`

const GameListEntryTextRow = styled.div<{ $color?: 'primary' | 'secondary' }>`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  color: ${props => (props.$color === 'secondary' ? colorTextSecondary : colorTextPrimary)};
`

const MapName = styled.div`
  ${body2};
  ${singleLine};
  flex-shrink: 1;
`

const GameListEntryResult = styled.div<{ $result: ReconciledResult }>`
  ${body2};
  color: ${props => {
    switch (props.$result) {
      case 'win':
        return colorPositive
      case 'loss':
        return colorNegative
      default:
        return colorTextFaint
    }
  }};
  text-transform: capitalize;
  padding-left: 8px;
  flex-shrink: 0;
`

export interface ConnectedGameListEntryProps {
  forUserId: SbUserId
  game: Immutable<GameRecordJson>
  onSetActive: (gameId: string) => void
  active: boolean
}

export function ConnectedGameListEntry({
  forUserId,
  game,
  onSetActive,
  active,
}: ConnectedGameListEntryProps) {
  const { id } = game
  const onClick = useCallback(() => {
    onSetActive(id)
  }, [id, onSetActive])
  const onDoubleClick = useCallback(() => {
    navigateToGameResults(id)
  }, [id])
  const [buttonProps, rippleRef] = useButtonState({ onClick, onDoubleClick })

  const map = useAppSelector(s => s.maps2.byId.get(game.mapId))

  const { results, startTime, config } = game
  const result = useMemo(() => {
    if (!results) {
      return 'unknown'
    }

    for (const [userId, r] of results) {
      if (userId === forUserId) {
        return r.result
      }
    }

    return 'unknown'
  }, [results, forUserId])

  // TODO(tec27): Handle more ranked types, show mode (UMS, Top v Bottom, etc.?)
  const matchType = config.gameSource === 'MATCHMAKING' ? 'Ranked 1v1' : 'Custom game'
  const mapName = map?.name ?? 'Unknown map'

  return (
    <GameListEntryRoot {...buttonProps} $active={active}>
      <GameListEntryTextRow $color='primary'>
        <MapName title={mapName}>{mapName}</MapName>
        <GameListEntryResult $result={result}>{result}</GameListEntryResult>
      </GameListEntryTextRow>

      <GameListEntryTextRow $color='secondary'>
        <Body1>{matchType}</Body1>
        <Body1>{timeAgo(Date.now() - startTime)}</Body1>
      </GameListEntryTextRow>

      <Ripple ref={rippleRef} />
    </GameListEntryRoot>
  )
}

const GamePreviewRoot = styled.div`
  position: relative;
  width: 276px;
  flex-shrink: 0;
  padding: 16px 16px 20px;

  display: flex;
  flex-direction: column;

  background-color: ${background700};
  border-radius: 4px;
`

const NoGameText = styled.div`
  ${subtitle1};
  color: ${colorTextFaint};
  text-align: center;
`

const GamePreviewPlayers = styled.div`
  position: absolute;
  bottom: 12px; /* 12px + 8px from player bottom margin = 20px */
  left: 16px;
  right: 16px;

  column-count: 2;
  column-gap: 16px;
  padding-top: 48px;

  background: linear-gradient(to bottom, ${rgba(background700, 0)}, ${background700} 40%);
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
`

const GamePreviewPlayerRandomIcon = styled(RaceIcon)`
  position: absolute;
  bottom: 0;
  right: 0;
  width: auto;
  height: 12px;
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

export interface ConnectedGamePreviewProps {
  game?: Immutable<GameRecordJson>
}

export function ConnectedGamePreview({ game }: ConnectedGamePreviewProps) {
  const dispatch = useAppDispatch()

  const mapId = game?.mapId
  const map = useAppSelector(s => (mapId ? s.maps2.byId.get(mapId) : undefined))
  const players = useAppSelector(s => {
    if (!game) {
      return []
    }

    const onlyHumans = game.config.teams.flat().filter(p => !p.isComputer)
    return onlyHumans.map(p => s.users.byId.get(p.id)!)
  })
  const playersMapping = useMemo(
    () => new Map<number, SbUser>(players.map(p => [p.id, p])),
    [players],
  )

  const onMapPreview = useCallback(() => {
    if (!map) {
      return
    }

    dispatch(openMapPreviewDialog(map.id))
  }, [map, dispatch])

  useEffect(() => {
    if (mapId) {
      dispatch(batchGetMapInfo(mapId))
    }
  }, [dispatch, mapId])

  const resultsById = useMemo(() => {
    return new Map(game?.results ?? [])
  }, [game?.results])

  if (!game) {
    return (
      <GamePreviewRoot>
        <NoGameText>No game selected</NoGameText>
      </GamePreviewRoot>
    )
  }

  const playerElems: React.ReactNode[] = []
  if (game.config.gameType === 'topVBottom') {
    playerElems.push(<GamePreviewTeamOverline key={'team-top'}>Top</GamePreviewTeamOverline>)
    playerElems.push(
      ...game.config.teams[0].map((p, i) => {
        const result = p.isComputer ? undefined : resultsById.get(p.id)
        return (
          <GamePreviewPlayer key={`team-top-${i}`}>
            <GamePreviewPlayerRace race={result?.race ?? p.race} isRandom={p.race === 'r'} />
            <span>
              {p.isComputer ? 'Computer' : playersMapping.get(p.id)?.name ?? 'Unknown player'}
            </span>
          </GamePreviewPlayer>
        )
      }),
    )

    playerElems.push(<GamePreviewTeamOverline key={'team-bottom'}>Bottom</GamePreviewTeamOverline>)
    playerElems.push(
      ...game.config.teams[1].map((p, i) => {
        const result = p.isComputer ? undefined : resultsById.get(p.id)
        return (
          <GamePreviewPlayer key={`team-bottom-${i}`}>
            <GamePreviewPlayerRace race={result?.race ?? p.race} isRandom={p.race === 'r'} />
            <span>
              {p.isComputer ? 'Computer' : playersMapping.get(p.id)?.name ?? 'Unknown player'}
            </span>
          </GamePreviewPlayer>
        )
      }),
    )
  } else {
    // TODO(tec27): Handle UMS game types with 2 teams? Always add team labels for 1v1?
    playerElems.push(
      ...game.config.teams.flatMap((t, i) =>
        t.map((p, j) => {
          const result = p.isComputer ? undefined : resultsById.get(p.id)
          return (
            <GamePreviewPlayer key={`team-${i}-${j}`}>
              <GamePreviewPlayerRace race={result?.race ?? p.race} isRandom={p.race === 'r'} />
              <span>
                {p.isComputer ? 'Computer' : playersMapping.get(p.id)?.name ?? 'Unknown player'}
              </span>
            </GamePreviewPlayer>
          )
        }),
      ),
    )
  }

  // NOTE(tec27): If there are an uneven number of items, column-count does really weird stuff
  // splitting the middle element across both columns, which we definitely don't want. Instead we
  // just add a dummy entry at the end to balance the columns.
  if (playerElems.length % 2 !== 0) {
    playerElems.push(<GamePreviewPlayer key={`placeholder`} />)
  }

  return (
    <GamePreviewRoot>
      {map ? <MapThumbnail key={map.hash} map={map} size={256} onPreview={onMapPreview} /> : null}
      <GamePreviewPlayers>{playerElems}</GamePreviewPlayers>
    </GamePreviewRoot>
  )
}
