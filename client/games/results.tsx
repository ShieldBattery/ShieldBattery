import { Immutable } from 'immer'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { GameConfigPlayer, isTeamType } from '../../common/games/configuration'
import { GameRecordJson, getGameTypeLabel } from '../../common/games/games'
import { ReconciledPlayerResult, ReconciledResult } from '../../common/games/results'
import { getTeamNames } from '../../common/maps'
import { SbUserId } from '../../common/users/user-info'
import { useSelfUser } from '../auth/state-hooks'
import { ComingSoon } from '../coming-soon/coming-soon'
import RefreshIcon from '../icons/material/ic_refresh_black_24px.svg'
import { RaceIcon } from '../lobbies/race-icon'
import { batchGetMapInfo } from '../maps/action-creators'
import { MapThumbnail } from '../maps/map-thumbnail'
import { RaisedButton, useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import Card from '../material/card'
import { Ripple } from '../material/ripple'
import { shadow2dp } from '../material/shadows'
import { TabItem, Tabs } from '../material/tabs'
import { useRefreshToken } from '../network/refresh-token'
import { navigateToUserProfile } from '../profile/action-creators'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import {
  amberA200,
  colorNegative,
  colorPositive,
  colorTextFaint,
  colorTextSecondary,
} from '../styles/colors'
import {
  body1,
  body2,
  Headline3,
  headline6,
  overline,
  singleLine,
  subtitle1,
  subtitle2,
} from '../styles/typography'
import {
  navigateToGameResults,
  subscribeToGame,
  unsubscribeFromGame,
  viewGame,
} from './action-creators'
import { ResultsSubPage } from './results-sub-page'

const Container = styled.div`
  min-width: 640px;
  max-width: 960px;
  padding: 0px 12px 24px;
`

const TabArea = styled.div`
  width: 100%;
  max-width: 720px;
`

const ButtonBar = styled.div`
  width: 100%;
  margin: 0 0 8px;
  padding: 0 24px;

  display: flex;

  & > * + * {
    margin-left: 8px;
  }
`

const ButtonSpacer = styled.div`
  flex-grow: 1;
`

const HeaderArea = styled.div`
  height: 72px;
  margin: 8px 0;
  padding: 0 24px;

  display: flex;
  align-items: center;
  justify-content: space-between;
`

const HeaderInfo = styled.div`
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(2, min-content);
  grid-template-columns: repeat(2, min-content);
  grid-gap: 4px 32px;

  align-items: center;
  justify-items: start;
`

const HeaderInfoItem = styled.div`
  display: flex;
  align-items: center;

  color: ${colorTextSecondary};
`

const HeaderInfoLabel = styled.div`
  ${overline};
  ${singleLine};
  width: 88px;
  margin-right: 16px;

  // The all-caps variation used for overlines doesn't really align vertically between these fonts
  // so we adjust manually
  line-height: 23px;
  padding-top: 1px;

  text-align: right;
`

const HeaderInfoValue = styled.div`
  ${subtitle1};
  ${singleLine};
`

const LiveIndicator = styled.div`
  ${body2};
  ${singleLine};

  color: ${amberA200};
`

const FinalIndicator = styled.div`
  ${body2};
  ${singleLine};

  color: ${colorTextFaint};
`

const gameDateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
})

const longGameDateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
})

function getDurationStr(durationMs: number): string {
  const timeSec = Math.floor(durationMs / 1000)
  const hours = Math.floor(timeSec / 3600)
  const minutes = Math.floor(timeSec / 60) % 60
  const seconds = timeSec % 60

  return [hours, minutes, seconds]
    .map(v => ('' + v).padStart(2, '0'))
    .filter((v, i) => v !== '00' || i > 0)
    .join(':')
}

export interface ConnectedGameResultsPageProps {
  gameId: string
  subPage?: ResultsSubPage
}

export function ConnectedGameResultsPage({
  gameId,
  subPage = ResultsSubPage.Summary,
}: ConnectedGameResultsPageProps) {
  const dispatch = useAppDispatch()
  const onTabChange = useCallback(
    (tab: ResultsSubPage) => {
      navigateToGameResults(gameId, tab)
    },
    [gameId],
  )

  const selfUser = useSelfUser()
  const game = useAppSelector(s => s.games.byId.get(gameId))
  const [loadingError, setLoadingError] = useState<Error>()
  const [isLoading, setIsLoading] = useState(!game)
  const cancelLoadRef = useRef(new AbortController())
  const [refreshToken, triggerRefresh] = useRefreshToken()

  const results = game?.results

  useEffect(() => {
    cancelLoadRef.current.abort()
    const abortController = new AbortController()
    cancelLoadRef.current = abortController

    setIsLoading(true)

    dispatch(
      viewGame(gameId, {
        signal: abortController.signal,
        onSuccess: () => {
          setLoadingError(undefined)
          setIsLoading(false)
        },
        onError: err => {
          setLoadingError(err)
          setIsLoading(false)
        },
      }),
    )

    return () => {
      abortController.abort()
      setIsLoading(false)
    }
  }, [gameId, refreshToken, dispatch])

  useEffect(() => {
    // At the moment the only time a game will really change is when it doesn't have results yet, so
    // we only subscribe in that case. If we start updating game records more often, we may want to
    // subscribe all the time
    if (!results) {
      dispatch(subscribeToGame(gameId))
      return () => {
        dispatch(unsubscribeFromGame(gameId))
      }
    }

    return () => {}
  }, [gameId, results, dispatch])

  let content: React.ReactNode
  switch (subPage) {
    case ResultsSubPage.Summary:
      content = (
        <SummaryPage
          gameId={gameId}
          game={game}
          loadingError={loadingError}
          isLoading={isLoading}
        />
      )
      break

    case ResultsSubPage.Stats:
    case ResultsSubPage.BuildOrders:
      content = <ComingSoonPage />
      break

    default:
      content = assertUnreachable(subPage)
  }

  const headline = useMemo<string>(() => {
    if (game && !game.results) {
      return 'In progress…'
    } else if (
      game &&
      game.config.teams.some(t => t.some(p => !p.isComputer && p.id === selfUser.id))
    ) {
      for (const [id, result] of game.results!) {
        if (id === selfUser.id) {
          switch (result.result) {
            case 'win':
              return 'Victory!'
            case 'loss':
              return 'Defeat!'
            case 'draw':
            case 'unknown':
              return 'Draw!'
            default:
              return assertUnreachable(result.result)
          }
        }
      }
    }

    return 'Results'
  }, [selfUser, game])

  return (
    <Container>
      <HeaderArea>
        <Headline3>{headline}</Headline3>
        <HeaderInfo>
          {game ? (
            <>
              <HeaderInfoItem>
                <HeaderInfoLabel>Type</HeaderInfoLabel>
                <HeaderInfoValue>{getGameTypeLabel(game)}</HeaderInfoValue>
              </HeaderInfoItem>
              <HeaderInfoItem>
                <HeaderInfoLabel>Date</HeaderInfoLabel>
                <HeaderInfoValue title={longGameDateFormat.format(game.startTime)}>
                  {gameDateFormat.format(game.startTime)}
                </HeaderInfoValue>
              </HeaderInfoItem>
              <HeaderInfoItem>
                <HeaderInfoLabel>Duration</HeaderInfoLabel>
                <HeaderInfoValue>
                  {game.gameLength ? getDurationStr(game.gameLength) : '—'}
                </HeaderInfoValue>
              </HeaderInfoItem>
            </>
          ) : null}
        </HeaderInfo>
        {!game?.results ? (
          <LiveIndicator>Live</LiveIndicator>
        ) : (
          <FinalIndicator>Final</FinalIndicator>
        )}
      </HeaderArea>
      <ButtonBar>
        {/* TODO(tec27): Search again, watch replay, etc. */}
        <ButtonSpacer />
        <RaisedButton label='Refresh' iconStart={<RefreshIcon />} onClick={triggerRefresh} />
      </ButtonBar>
      <TabArea>
        <Tabs activeTab={subPage} onChange={onTabChange}>
          <TabItem value={ResultsSubPage.Summary} text='Summary' />
          <TabItem value={ResultsSubPage.Stats} text='Stats' />
          <TabItem value={ResultsSubPage.BuildOrders} text='Build orders' />
        </Tabs>
      </TabArea>
      {content}
    </Container>
  )
}

const ComingSoonRoot = styled.div`
  /* 34px + 6px from tab = 40px */
  margin-top: 34px;
  padding: 0 24px;
`

function ComingSoonPage() {
  return (
    <ComingSoonRoot>
      <ComingSoon />
    </ComingSoonRoot>
  )
}

const LoadingError = styled.div`
  ${subtitle1};
  width: 100%;
  margin-top: 32px;
  margin-bottom: 48px;
  padding: 0 24px;
`

const SummaryRoot = styled.div<{ $isLoading?: boolean }>`
  width: 100%;
  margin-top: 16px;
  padding: 0 24px;

  display: grid;
  grid-auto-flow: row;
  grid-auto-rows: max-content;
  grid-template-columns: repeat(8, 1fr);
  grid-gap: 24px 24px;

  opacity: ${props => (props.$isLoading ? 0.6 : 1)};
  transition: opacity linear 100ms;
`

const MAP_SIZE = ((960 - 48 - 24) / 8) * 3

const MapContainer = styled.div`
  grid-column: 6 / 9;
  height: auto;

  text-align: center;
`

const StyledMapThumbnail = styled(MapThumbnail)`
  ${shadow2dp};
`

const MapName = styled.div`
  ${headline6};
  ${singleLine};
  margin-top: 8px;
`

const PlayerListContainer = styled.div`
  grid-column: 1 / 6;
`

const PlayerListCard = styled(Card)`
  padding: 8px;
`

const TeamLabel = styled.div`
  ${overline};
  ${singleLine};

  height: 24px;
  line-height: 24px;
  margin: 0 8px;

  color: ${colorTextSecondary};
`

type ConfigAndResult = [config: GameConfigPlayer, result: ReconciledPlayerResult | undefined]

function SummaryPage({
  gameId,
  game,
  loadingError,
  isLoading,
}: {
  gameId: string
  game?: Immutable<GameRecordJson>
  loadingError?: Error
  isLoading: boolean
}) {
  const dispatch = useAppDispatch()

  const mapId = game?.mapId
  const map = useAppSelector(s => (mapId ? s.maps2.byId.get(mapId) : undefined))

  const [configAndResults, teamLabels] = useMemo((): [
    Map<SbUserId | string, ConfigAndResult>,
    string[],
  ] => {
    const result = new Map<SbUserId | string, ConfigAndResult>()

    if (!game) {
      return [result, []]
    }

    const teamLabels =
      isTeamType(game.config.gameType) && map
        ? getTeamNames(game.config.gameType, game.config.gameSubType, map.mapData.umsForces)
        : []

    for (let i = 0; i < game.config.teams.length; i++) {
      const team = game.config.teams[i]
      for (let j = 0; j < team.length; j++) {
        const p = team[j]
        // Computers annoyingly have no unique ID, so we create one here :(
        const key = p.isComputer ? `${i}-${j}` : p.id
        result.set(key, [p, undefined])
      }
    }

    if (game.results) {
      for (const [id, r] of game.results) {
        result.get(id)![1] = r
      }
    }

    return [result, teamLabels]
  }, [game, map])

  useEffect(() => {
    if (mapId) {
      dispatch(batchGetMapInfo(mapId))
    }
  }, [dispatch, mapId])

  if (loadingError) {
    // TODO(tec27): Handle specific errors, e.g. not found vs server error
    return <LoadingError>There was a problem loading this game.</LoadingError>
  }
  if (!game) {
    return <LoadingDotsArea />
  }

  const showTeams = isTeamType(game.config.gameType)
  const playerListItems = game.config.teams.flatMap((team, i) => {
    const elems = team.map((p, j) => {
      const key = p.isComputer ? `${i}-${j}` : p.id
      const [config, result] = configAndResults.get(key)!
      return <PlayerResult key={String(key)} config={config} result={result} />
    })

    if (showTeams) {
      elems.unshift(
        <TeamLabel key={`team-${i}`}>
          {teamLabels.length > i ? teamLabels[i] : 'Team ' + (i + 1)}
        </TeamLabel>,
      )
    }

    return elems
  })

  return (
    <SummaryRoot $isLoading={isLoading}>
      <PlayerListContainer>
        <PlayerListCard>{playerListItems}</PlayerListCard>
      </PlayerListContainer>
      <MapContainer>
        {map ? <StyledMapThumbnail map={map} size={MAP_SIZE} /> : null}
        {map ? <MapName>{map.name}</MapName> : null}
      </MapContainer>
    </SummaryRoot>
  )
}

const PlayerResultContainer = styled.button`
  ${buttonReset};

  width: 100%;
  height: 36px;
  padding-left: 8px;
  padding-right: 8px;

  display: flex;
  align-items: center;
  cursor: pointer;
  text-align: left;

  & + ${TeamLabel} {
    margin-top: 16px;
  }
`

const RaceRoot = styled.div`
  position: relative;
  width: auto;
  height: 24px;
`

const StyledRaceIcon = styled(RaceIcon)`
  width: auto;
  height: 100%;
`

const SelectedRandomIcon = styled(RaceIcon)`
  position: absolute;
  bottom: 0;
  right: 0;
  width: auto;
  height: 12px;
`

const PlayerName = styled.div`
  ${subtitle2};
  ${singleLine};
  margin-left: 8px;
  margin-right: 8px;
  flex-grow: 1;
`

const PlayerApm = styled.div`
  ${body1};
  ${singleLine};
  width: 96px;
  color: ${colorTextSecondary};
  text-align: right;
`

const StyledGameResultText = styled(GameResultText)`
  ${body1};
  ${singleLine};
  width: 96px;
  text-align: right;
`

export interface PlayerResultProps {
  className?: string
  config: GameConfigPlayer
  result?: ReconciledPlayerResult
}

export function PlayerResult({ className, config, result }: PlayerResultProps) {
  const user = useAppSelector(s => (config.isComputer ? undefined : s.users.byId.get(config.id)))
  const [buttonProps, rippleRef] = useButtonState({
    onClick: () => user && navigateToUserProfile(user.id, user.name),
  })

  return (
    <PlayerResultContainer className={className} {...buttonProps}>
      <RaceRoot>
        <StyledRaceIcon race={result?.race ?? config.race} />
        {result?.race && config.race === 'r' ? <SelectedRandomIcon race='r' /> : null}
      </RaceRoot>
      <PlayerName>{config.isComputer ? 'Computer' : user?.name ?? ''}</PlayerName>
      <PlayerApm>{result?.apm ?? 0} APM</PlayerApm>
      <StyledGameResultText result={result?.result ?? 'unknown'} />
      <Ripple ref={rippleRef} />
    </PlayerResultContainer>
  )
}

export interface GameResultTextProps {
  className?: string
  result: ReconciledResult
}

const PositiveText = styled.span`
  color: ${colorPositive};
`

const NegativeText = styled.span`
  color: ${colorNegative};
`

export function GameResultText({ className, result }: GameResultTextProps) {
  switch (result) {
    case 'win':
      return <PositiveText className={className}>Win</PositiveText>
    case 'loss':
      return <NegativeText className={className}>Loss</NegativeText>
    case 'draw':
      return <span className={className}>Draw</span>
    case 'unknown':
      return <span className={className}>—</span>
    default:
      return assertUnreachable(result)
  }
}
