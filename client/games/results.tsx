import type { TFunction } from 'i18next'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { assertUnreachable } from '../../common/assert-unreachable'
import { GameConfigPlayer, GameSource } from '../../common/games/configuration'
import { isTeamType } from '../../common/games/game-type'
import {
  GameDebugInfoJson,
  GameRecordJson,
  getGameDurationString,
  getGameTypeLabel,
} from '../../common/games/games'
import {
  GameClientResult,
  ReconciledPlayerResult,
  ReconciledResult,
  getResultLabel,
} from '../../common/games/results'
import { getTeamNames } from '../../common/maps'
import { PublicMatchmakingRatingChangeJson } from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfPermissions, useSelfUser } from '../auth/auth-utils'
import { Avatar } from '../avatars/avatar'
import ComputerAvatar from '../avatars/computer-avatar'
import { ComingSoon } from '../coming-soon/coming-soon'
import { longTimestamp, longTimestampWithSeconds } from '../i18n/date-formats'
import FindMatchIcon from '../icons/shieldbattery/ic_satellite_dish_black_36px.svg'
import { RaceIcon } from '../lobbies/race-icon'
import { batchGetMapInfo } from '../maps/action-creators'
import { MapThumbnail } from '../maps/map-thumbnail'
import { isMatchmakingAtom } from '../matchmaking/matchmaking-atoms'
import { FilledButton, useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Card } from '../material/card'
import { Ripple } from '../material/ripple'
import { elevationPlus1 } from '../material/shadows'
import { TabItem, Tabs } from '../material/tabs'
import { Tooltip, TooltipContent, TooltipPosition } from '../material/tooltip'
import { CopyLinkButton } from '../navigation/copy-link-button'
import { replace } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { CenteredContentContainer } from '../styles/centered-container'
import { ContainerLevel, containerStyles } from '../styles/colors'
import {
  DisplaySmall,
  bodyLarge,
  bodyMedium,
  labelMedium,
  singleLine,
  titleLarge,
  titleMedium,
  titleSmall,
} from '../styles/typography'
import { navigateToUserProfile } from '../users/action-creators'
import { ConnectedUsername } from '../users/connected-username'
import {
  navigateToGameResults,
  searchAgainFromGame,
  subscribeToGame,
  unsubscribeFromGame,
  viewGame,
} from './action-creators'
import { ResultsSubPage } from './results-sub-page'

const Container = styled(CenteredContentContainer)`
  padding-block: 16px;
`

const TabArea = styled.div`
  width: 100%;
  max-width: 720px;
  padding: 0 24px;
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
  align-items: baseline;

  color: var(--theme-on-surface);
`

const HeaderInfoLabel = styled.div`
  ${labelMedium};
  ${singleLine};
  width: 88px;
  margin-right: 16px;

  color: var(--theme-on-surface-variant);
  text-align: right;
`

const HeaderInfoValue = styled.div`
  ${bodyLarge};
  ${singleLine};
`

const LiveFinalIndicator = styled.div<{ $isLive: boolean }>`
  ${titleSmall};
  ${singleLine};

  color: ${props => (props.$isLive ? 'var(--color-amber90)' : 'var(--theme-on-surface)')};
`

const StyledFindMatchIcon = styled(FindMatchIcon)`
  height: 24px;
  width: auto;
`

const gameDateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
})

export interface ConnectedGameResultsPageProps {
  gameId: string
  subPage?: ResultsSubPage
}

export function ConnectedGameResultsPage({
  gameId,
  subPage = ResultsSubPage.Summary,
}: ConnectedGameResultsPageProps) {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  const isPostGame = location.search === '?post-game'
  const onTabChange = useCallback(
    (tab: ResultsSubPage) => {
      navigateToGameResults(gameId, isPostGame, tab)
    },
    [gameId, isPostGame],
  )

  const selfUser = useSelfUser()
  const game = useAppSelector(s => s.games.byId.get(gameId))
  const [loadingError, setLoadingError] = useState<Error>()
  const [isLoading, setIsLoading] = useState(!game)
  const cancelLoadRef = useRef(new AbortController())
  const canSearchMatchmaking = !useAtomValue(isMatchmakingAtom)

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
  }, [gameId, dispatch])

  useEffect(() => {
    // At the moment the only time a game will really change is when it doesn't have results yet, so
    // we only subscribe in that case. If we start updating game records more often, we may want to
    // subscribe all the time
    if (selfUser && !isLoading && !results) {
      dispatch(subscribeToGame(gameId))
      return () => {
        // TODO(tec27): We may want to be more picky about when we do this, so we limit the number
        // of requests we send here
        dispatch(unsubscribeFromGame(gameId))
      }
    }

    return () => {}
  }, [gameId, isLoading, results, dispatch, selfUser])

  useEffect(() => {
    if (
      isPostGame &&
      game &&
      (!selfUser ||
        !game.config.teams.some(t => t.some(p => !p.isComputer && p.id === selfUser.id)))
    ) {
      // If the user isn't in this game, they shouldn't be looking at the post-game screen. Mostly
      // just handles someone getting linked here somehow (or trying to be tricky :) ). Stops
      // potential local errors, nothing this really enables remotely
      navigateToGameResults(game.id, false, subPage, replace)
    }
  }, [isPostGame, game, selfUser, subPage])

  const headline = useMemo<string>(() => {
    if (game && !game.results) {
      return t('gameDetails.headlineInProgress', 'In progress…')
    } else if (
      selfUser &&
      game &&
      game.config.teams.some(t => t.some(p => !p.isComputer && p.id === selfUser.id))
    ) {
      for (const [id, result] of game.results!) {
        if (id === selfUser.id) {
          switch (result.result) {
            case 'win':
              return t('gameDetails.headlineVictory', 'Victory!')
            case 'loss':
              return t('gameDetails.headlineDefeat', 'Defeat!')
            case 'draw':
            case 'unknown':
              return t('gameDetails.headlineDraw', 'Draw!')
            default:
              return assertUnreachable(result.result)
          }
        }
      }
    }

    return t('gameDetails.headlineDefault', 'Results')
  }, [game, t, selfUser])

  const config = game?.config
  const onSearchAgain = useCallback(() => {
    if (!config || config.gameSource !== GameSource.Matchmaking) {
      return
    }

    dispatch(searchAgainFromGame(config))
  }, [config, dispatch])

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

  const showSearchAgain = isPostGame && config?.gameSource === GameSource.Matchmaking
  const disableSearchAgain = !canSearchMatchmaking
  const isLive = !game?.results

  return (
    <Container>
      <HeaderArea>
        <DisplaySmall>{headline}</DisplaySmall>
        <HeaderInfo>
          {game ? (
            <>
              <HeaderInfoItem>
                <HeaderInfoLabel>{t('gameDetails.infoGameType', 'Type')}</HeaderInfoLabel>
                <HeaderInfoValue>{getGameTypeLabel(game, t)}</HeaderInfoValue>
              </HeaderInfoItem>
              <HeaderInfoItem>
                <HeaderInfoLabel>{t('gameDetails.infoDate', 'Date')}</HeaderInfoLabel>
                <HeaderInfoValue title={longTimestamp.format(game.startTime)}>
                  {gameDateFormat.format(game.startTime)}
                </HeaderInfoValue>
              </HeaderInfoItem>
              <HeaderInfoItem>
                <HeaderInfoLabel>{t('gameDetails.infoDuration', 'Duration')}</HeaderInfoLabel>
                <HeaderInfoValue>
                  {game.gameLength ? getGameDurationString(game.gameLength) : '—'}
                </HeaderInfoValue>
              </HeaderInfoItem>
            </>
          ) : null}
        </HeaderInfo>
        <LiveFinalIndicator $isLive={isLive}>
          {isLive ? t('gameDetails.statusLive', 'Live') : t('gameDetails.statusFinal', 'Final')}
        </LiveFinalIndicator>
      </HeaderArea>
      <ButtonBar>
        {showSearchAgain ? (
          <FilledButton
            label={t('gameDetails.buttonSearchAgain', 'Search again')}
            iconStart={<StyledFindMatchIcon />}
            disabled={disableSearchAgain}
            onClick={onSearchAgain}
          />
        ) : null}
        {/* TODO(tec27): Search again, watch replay, etc. */}
        <ButtonSpacer />
        <CopyLinkButton
          startingText={t('gameDetails.buttonCopyLink', 'Copy link to game')}
          tooltipPosition='left'
        />
      </ButtonBar>
      <TabArea>
        <Tabs activeTab={subPage} onChange={onTabChange}>
          <TabItem value={ResultsSubPage.Summary} text={t('gameDetails.tabSummary', 'Summary')} />
          <TabItem value={ResultsSubPage.Stats} text={t('gameDetails.tabStats', 'Stats')} />
          <TabItem
            value={ResultsSubPage.BuildOrders}
            text={t('gameDetails.tabBuildOrders', 'Build orders')}
          />
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
  text-align: center;
`

function ComingSoonPage() {
  return (
    <ComingSoonRoot>
      <ComingSoon />
    </ComingSoonRoot>
  )
}

const LoadingError = styled.div`
  ${bodyLarge};
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
  ${elevationPlus1};
  height: auto;
`

const MapName = styled.div`
  ${titleLarge};
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
  ${labelMedium};
  ${singleLine};

  height: 24px;
  line-height: 24px;
  margin: 0 8px;

  color: var(--theme-on-surface-variant);
`

type ConfigAndResult = [config: GameConfigPlayer, result: ReconciledPlayerResult | undefined]

function SummaryPage({
  gameId,
  game,
  loadingError,
  isLoading,
}: {
  gameId: string
  game?: ReadonlyDeep<GameRecordJson>
  loadingError?: Error
  isLoading: boolean
}) {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const hasDebugPermission = !!useSelfPermissions()?.debug

  const mapId = game?.mapId
  const map = useAppSelector(s => (mapId ? s.maps.byId.get(mapId) : undefined))
  const mmrChanges = useAppSelector(s => s.games.mmrChangesById.get(gameId))
  const debugInfo = useAppSelector(s => s.games.debugInfoById.get(gameId))

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
        ? getTeamNames(
            {
              gameType: game.config.gameType,
              gameSubType: game.config.gameSubType,
              umsForces: map.mapData.umsForces,
            },
            t,
          )
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
  }, [game, map, t])

  useEffect(() => {
    if (mapId) {
      dispatch(batchGetMapInfo(mapId))
    }
  }, [dispatch, mapId])

  if (loadingError) {
    // TODO(tec27): Handle specific errors, e.g. not found vs server error
    return (
      <LoadingError>
        {t('gameDetails.errorLoading', 'There was a problem loading this game.')}
      </LoadingError>
    )
  }
  if (!game) {
    return <LoadingDotsArea />
  }

  const showTeams = isTeamType(game.config.gameType)
  const playerListItems = game.config.teams.flatMap((team, i) => {
    const elems = team.map((p, j) => {
      const key = p.isComputer ? `${i}-${j}` : p.id
      const [config, result] = configAndResults.get(key)!
      return (
        <PlayerResult
          key={String(key)}
          config={config}
          result={result}
          mmrChange={!p.isComputer ? mmrChanges?.get(p.id) : undefined}
        />
      )
    })

    if (showTeams) {
      elems.unshift(
        <TeamLabel key={`team-${i}`}>
          {teamLabels.length > i
            ? teamLabels[i]
            : t('game.teamName.number', {
                defaultValue: 'Team {{teamNumber}}',
                teamNumber: i + 1,
              })}
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

      {hasDebugPermission && debugInfo ? <DebugInfoDisplay debugInfo={debugInfo} /> : null}
    </SummaryRoot>
  )
}

const PlayerResultContainer = styled.button`
  ${buttonReset};

  width: 100%;
  height: 56px;
  padding: 8px;

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
  height: 32px;
`

const StyledRaceIcon = styled(RaceIcon)`
  width: auto;
  height: 100%;
  aspect-ratio: 1;
`

const SelectedRandomIcon = styled(RaceIcon)`
  position: absolute;
  bottom: 0;
  right: 0;

  && {
    width: 20px;
    height: 20px;
  }

  & > * {
    text-shadow: 0 0 2px rgba(0, 0, 0, 0.7);
  }
`

const PlayerAvatar = styled(Avatar)`
  width: 40px;
  height: 40px;
  margin-left: 8px;
`

const StyledComputerAvatar = styled(ComputerAvatar).attrs({ size: 40 })`
  width: 40px;
  height: 40px;
  margin-left: 8px;
  color: var(--theme-on-surface-variant);
`

const PlayerName = styled.div`
  ${titleLarge};
  ${singleLine};
  margin-left: 16px;
  margin-right: 8px;
  flex-grow: 1;
`

const MmrChangeColumn = styled.div`
  width: 136px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
`

const GameResultColumn = styled.div`
  width: 72px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
`

const StyledGameResultText = styled(GameResultText)`
  ${bodyMedium};
  ${singleLine};
  width: 100%;
  text-align: right;
`

const StyledPointsChangeText = styled(MmrChangeText)`
  ${bodyMedium};
  ${singleLine};
  text-align: right;
`

export interface PlayerResultProps {
  className?: string
  config: GameConfigPlayer
  result?: ReconciledPlayerResult
  mmrChange?: ReadonlyDeep<PublicMatchmakingRatingChangeJson>
}

export function PlayerResult({ className, config, result, mmrChange }: PlayerResultProps) {
  const { t } = useTranslation()
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
      {config.isComputer ? <StyledComputerAvatar /> : <PlayerAvatar user={user?.name ?? ''} />}
      <PlayerName>
        {config.isComputer ? t('game.playerName.computer', 'Computer') : (user?.name ?? '')}
      </PlayerName>
      {mmrChange ? (
        <MmrChangeColumn>
          <StyledPointsChangeText change={mmrChange} />
        </MmrChangeColumn>
      ) : undefined}
      <GameResultColumn>
        <StyledGameResultText result={result?.result ?? 'unknown'} />
      </GameResultColumn>
      <Ripple ref={rippleRef} />
    </PlayerResultContainer>
  )
}

export interface GameResultTextProps {
  className?: string
  result: ReconciledResult
}

const PositiveText = styled.span`
  color: var(--theme-positive);
`

const NegativeText = styled.span`
  color: var(--theme-negative);
`

export function GameResultText({ className, result }: GameResultTextProps) {
  const { t } = useTranslation()

  const resultLabel = getResultLabel(result, t)
  switch (result) {
    case 'win':
      return <PositiveText className={className}>{resultLabel}</PositiveText>
    case 'loss':
      return <NegativeText className={className}>{resultLabel}</NegativeText>
    case 'draw':
      return <span className={className}>{resultLabel}</span>
    case 'unknown':
      return <span className={className}>—</span>
    default:
      return assertUnreachable(result)
  }
}

function MmrChangeText({
  className,
  change,
}: {
  className?: string
  change: PublicMatchmakingRatingChangeJson
}) {
  const { t } = useTranslation()

  const roundPoints = Math.round(change.points)
  const roundChange = Math.round(change.pointsChange)
  const changeWithoutBonus = Math.round(change.pointsChange - change.bonusUsedChange)
  const bonusChange = Math.round(change.bonusUsedChange)

  const PointsOverview = useCallback(
    (props: { $position: TooltipPosition }) => (
      <TooltipContent
        $position={props.$position}
        style={
          {
            '--theme-positive': 'var(--theme-positive-invert)',
            '--theme-negative': 'var(--theme-negative-invert)',
          } as any
        }>
        <div>
          <div>
            {t('gameDetails.summary.pointsBase', 'Base')}:{' '}
            <NumberDelta delta={changeWithoutBonus} />
          </div>
          <div>
            {t('gameDetails.summary.pointsBonus', 'Bonus')}: <NumberDelta delta={bonusChange} />
          </div>
        </div>
      </TooltipContent>
    ),
    [t, changeWithoutBonus, bonusChange],
  )

  const roundRating = Math.round(change.rating)
  const ratingChange = Math.round(change.ratingChange)

  return (
    <>
      <span>
        {roundRating} {t('gameDetails.summary.mmr', 'MMR')} (<NumberDelta delta={ratingChange} />)
      </span>
      <Tooltip className={className} text={''} ContentComponent={PointsOverview} position={'right'}>
        <span>
          {roundPoints} {t('gameDetails.summary.rp', 'RP')} (<NumberDelta delta={roundChange} />)
        </span>
      </Tooltip>
    </>
  )
}

function NumberDelta({ className, delta }: { className?: string; delta: number }) {
  if (delta === 0) {
    return <span className={className}>+0</span>
  } else if (delta > 0) {
    return <PositiveText className={className}>+{delta}</PositiveText>
  } else {
    return <NegativeText className={className}>{delta}</NegativeText>
  }
}

const DebugInfoSection = styled.div`
  grid-column: 1 / -1;
  width: 100%;
  margin-top: 24px;
`

const DebugCard = styled(Card)`
  ${containerStyles(ContainerLevel.Normal)};

  padding: 16px;
`

const DebugSectionTitle = styled.div`
  ${titleLarge};
  margin-bottom: 16px;
  color: var(--theme-on-surface-variant);
`

const DebugSubsectionTitle = styled.div`
  ${titleMedium};
  margin-top: 32px;
  color: var(--theme-on-surface);
`

const ReportTitle = styled.div`
  ${titleSmall};
  margin-block: 24px 8px;
  color: var(--theme-on-surface);
`

const DebugTableContainer = styled.div`
  width: 100%;
  margin-bottom: 16px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
  contain: paint;
`

const DebugTable = styled.table`
  width: 100%;

  th,
  td {
    ${bodyMedium};
    padding: 8px;
    text-align: left;

    vertical-align: middle;
  }

  td > svg {
    vertical-align: middle;
  }

  th {
    ${containerStyles(ContainerLevel.Normal)};
    ${labelMedium};
    color: var(--theme-on-surface-variant);
  }
`

const ResultCell = styled.td<{ $result: GameClientResult }>`
  color: ${props => {
    switch (props.$result) {
      case GameClientResult.Victory:
        return 'var(--theme-positive)'
      case GameClientResult.Defeat:
        return 'var(--theme-negative)'
      case GameClientResult.Disconnected:
        return 'var(--theme-on-surface-variant)'
      case GameClientResult.Playing:
      default:
        return 'var(--theme-on-surface)'
    }
  }};
`

const HasReportCell = styled.td<{ $hasReport: boolean }>`
  color: ${props => (props.$hasReport ? 'var(--theme-positive)' : 'var(--theme-negative)')};
`

function getClientResultLabel(result: GameClientResult, t: TFunction): string {
  switch (result) {
    case GameClientResult.Playing:
      return t('gameDetails.debugInfo.clientResult.playing', 'Playing')
    case GameClientResult.Disconnected:
      return t('gameDetails.debugInfo.clientResult.disconnected', 'Disconnected')
    case GameClientResult.Defeat:
      return t('gameDetails.debugInfo.clientResult.defeat', 'Defeat')
    case GameClientResult.Victory:
      return t('gameDetails.debugInfo.clientResult.victory', 'Victory')
    default:
      return String(result)
  }
}

function DebugInfoDisplay({ debugInfo }: { debugInfo: ReadonlyDeep<GameDebugInfoJson> }) {
  const { t } = useTranslation()

  return (
    <DebugInfoSection>
      <DebugCard>
        <DebugSectionTitle>
          {t('gameDetails.debugInfo.title', 'Debug Information')}
        </DebugSectionTitle>

        {debugInfo.routes.length > 0 && (
          <div>
            <DebugSubsectionTitle>
              {t('gameDetails.debugInfo.routes', 'Network Routes')}
            </DebugSubsectionTitle>
            <DebugTableContainer>
              <DebugTable>
                <thead>
                  <tr>
                    <th>{t('gameDetails.debugInfo.player1', 'Player 1')}</th>
                    <th>{t('gameDetails.debugInfo.player2', 'Player 2')}</th>
                    <th>{t('gameDetails.debugInfo.server', 'Server')}</th>
                    <th>{t('gameDetails.debugInfo.latency', 'Latency (ms)')}</th>
                  </tr>
                </thead>
                <tbody>
                  {debugInfo.routes.map((route, idx) => (
                    <tr key={idx}>
                      <td>
                        <ConnectedUsername userId={route.p1} />
                      </td>
                      <td>
                        <ConnectedUsername userId={route.p2} />
                      </td>
                      <td>
                        {route.serverDescription
                          ? `${route.serverDescription} (${route.server})`
                          : route.server}
                      </td>
                      <td>{route.latency.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </DebugTable>
            </DebugTableContainer>
          </div>
        )}

        <div>
          <DebugSubsectionTitle>
            {t('gameDetails.debugInfo.reportedResults', 'Individual Reports Summary')}
          </DebugSubsectionTitle>
          <DebugTableContainer>
            <DebugTable>
              <thead>
                <tr>
                  <th>{t('gameDetails.debugInfo.player', 'Player')}</th>
                  <th>{t('gameDetails.debugInfo.reportedAt', 'Reported At')}</th>
                  <th>{t('gameDetails.debugInfo.hasReport', 'Has Report')}</th>
                  <th>{t('gameDetails.debugInfo.reportedTime', 'Reported Time')}</th>
                </tr>
              </thead>
              <tbody>
                {debugInfo.reportedResults
                  .slice()
                  .sort((a, b) => {
                    // Sort by reported time - earliest first, undefined/null last
                    if (!a.reportedAt && !b.reportedAt) return 0
                    if (!a.reportedAt) return 1
                    if (!b.reportedAt) return -1
                    return a.reportedAt - b.reportedAt
                  })
                  .map(report => (
                    <tr key={report.userId}>
                      <td>
                        <ConnectedUsername userId={report.userId} />
                      </td>
                      <td>
                        {report.reportedAt ? (
                          <Tooltip
                            text={longTimestampWithSeconds.format(report.reportedAt)}
                            position='top'>
                            {longTimestamp.format(report.reportedAt)}
                          </Tooltip>
                        ) : (
                          '—'
                        )}
                      </td>
                      <HasReportCell $hasReport={!!report.reportedResults}>
                        {report.reportedResults ? 'Yes' : 'No'}
                      </HasReportCell>
                      <td>
                        {report.reportedResults
                          ? getGameDurationString(report.reportedResults.time)
                          : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </DebugTable>
          </DebugTableContainer>
        </div>

        {debugInfo.reportedResults.some(r => r.reportedResults) && (
          <div>
            <DebugSubsectionTitle>
              {t('gameDetails.debugInfo.detailedResults', 'Detailed Individual Results')}
            </DebugSubsectionTitle>
            {debugInfo.reportedResults
              .filter(r => r.reportedResults)
              .map(report => (
                <div key={report.userId} style={{ marginBottom: '16px' }}>
                  <ReportTitle>
                    {t('gameDetails.debugInfo.reportBy', 'Report by ')}
                    <ConnectedUsername userId={report.userId} />:
                  </ReportTitle>
                  <DebugTableContainer>
                    <DebugTable>
                      <thead>
                        <tr>
                          <th>{t('gameDetails.debugInfo.reportedPlayer', 'Player')}</th>
                          <th>{t('gameDetails.debugInfo.reportedResult', 'Result')}</th>
                          <th>{t('gameDetails.debugInfo.reportedRace', 'Race')}</th>
                          <th>{t('gameDetails.debugInfo.reportedAPM', 'APM')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.reportedResults!.playerResults.map(([playerId, playerResult]) => (
                          <tr key={playerId}>
                            <td>
                              <ConnectedUsername userId={playerId} />
                            </td>
                            <ResultCell $result={playerResult.result}>
                              {getClientResultLabel(playerResult.result, t)}
                            </ResultCell>
                            <td>
                              <StyledRaceIcon race={playerResult.race} />
                            </td>
                            <td>{playerResult.apm}</td>
                          </tr>
                        ))}
                      </tbody>
                    </DebugTable>
                  </DebugTableContainer>
                </div>
              ))}
          </div>
        )}
      </DebugCard>
    </DebugInfoSection>
  )
}
