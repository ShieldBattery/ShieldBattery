import type { TFunction } from 'i18next'
import { Transition } from 'motion/react'
import * as m from 'motion/react-m'
import prettyBytes from 'pretty-bytes'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { assertUnreachable } from '../../common/assert-unreachable'
import { getErrorStack } from '../../common/errors'
import { GameConfigPlayer } from '../../common/games/configuration'
import { isTeamType } from '../../common/games/game-type'
import {
  GameDebugInfoJson,
  GameRecordJson,
  GameReplayDebugInfo,
  getGameDurationString,
  getGameTypeLabel,
} from '../../common/games/games'
import {
  NetcodeV2FlightBlobInfo,
  NetcodeV2FlightBlobsResponse,
} from '../../common/games/netcode-v2'
import {
  GameClientResult,
  ReconciledPlayerResult,
  ReconciledResult,
  getResultLabel,
} from '../../common/games/results'
import { TypedIpcRenderer } from '../../common/ipc'
import { getTeamNames } from '../../common/maps'
import { NUM_PLACEMENT_MATCHES, PublicMatchmakingRatingChangeJson } from '../../common/matchmaking'
import { apiUrl } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfPermissions, useSelfUser } from '../auth/auth-utils'
import { Avatar } from '../avatars/avatar'
import ComputerAvatar from '../avatars/computer-avatar'
import { ComingSoon } from '../coming-soon/coming-soon'
import { openDialog, openSimpleDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { longTimestamp, longTimestampWithSeconds } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { RaceIcon } from '../lobbies/race-icon'
import logger from '../logging/logger'
import { batchGetMapInfo } from '../maps/action-creators'
import { ReduxMapThumbnail } from '../maps/map-thumbnail'
import { IconButton, OutlinedButton, useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Card } from '../material/card'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { Ripple } from '../material/ripple'
import { elevationPlus1 } from '../material/shadows'
import { TabItem, Tabs } from '../material/tabs'
import { Tooltip, TooltipContent, TooltipPosition } from '../material/tooltip'
import { CopyLinkButton } from '../navigation/copy-link-button'
import { replace } from '../navigation/routing'
import { fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { watchReplayFromUrl } from '../replays/action-creators'
import { CenteredContentContainer } from '../styles/centered-container'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { styledWithAttrs } from '../styles/styled-with-attrs'
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
  subscribeToGame,
  unsubscribeFromGame,
  viewGame,
} from './action-creators'
import { ResultsSubPage } from './results-sub-page'
import { SaveReplayMenuContent } from './save-replay-menu'

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
  margin: 0 0 16px;
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

const StatusRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const StatusChip = styled.div<{ $color: string }>`
  ${labelMedium};
  ${singleLine};

  height: 24px;
  padding: 0 12px;

  display: flex;
  align-items: center;
  flex-shrink: 0;

  border: 1px solid currentColor;
  border-radius: 12px;
  color: ${props => props.$color};
`

const gameDateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
})

const ipcRenderer = new TypedIpcRenderer()

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
  const selfPermissions = useSelfPermissions()
  const hasDebugPermission = !!selfPermissions?.debug
  const canManageGameReports = !!selfPermissions?.manageGameReports
  const game = useAppSelector(s => s.games.byId.get(gameId))
  const replayInfo = useAppSelector(s => s.games.replayInfoById.get(gameId))
  const [loadingError, setLoadingError] = useState<Error>()
  const [isLoading, setIsLoading] = useState(!game)
  const cancelLoadRef = useRef(new AbortController())
  const cancelSaveRef = useRef(new AbortController())
  const [isDownloadingReplay, setIsDownloadingReplay] = useState(false)
  const [isSavingReplay, setIsSavingReplay] = useState(false)
  const [isReplaySaved, setIsReplaySaved] = useState(false)
  const [saveAnchor, saveAnchorX, saveAnchorY, refreshSaveAnchorPos] =
    useRefAnchorPosition<HTMLButtonElement>('left', 'bottom')
  const [saveMenuOpen, openSaveMenu, closeSaveMenu] = usePopoverController({
    refreshAnchorPos: refreshSaveAnchorPos,
  })

  const results = game?.results

  useEffect(() => {
    cancelLoadRef.current.abort()
    const abortController = new AbortController()
    cancelLoadRef.current = abortController

    dispatch(
      viewGame(gameId, {
        signal: abortController.signal,
        onStart: () => {
          setIsLoading(true)
        },
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

  useEffect(() => {
    if (!IS_ELECTRON) {
      return () => {}
    }

    let isMounted = true
    ipcRenderer
      .invoke('replayLibraryFindByGameId', gameId)
      ?.then(replayId => {
        // Set unconditionally: this page isn't keyed by gameId, so the instance (and this state) is
        // reused across navigations -- without resetting, a previously-saved game would leave the
        // button stuck on "In library" for a game whose replay isn't saved.
        if (isMounted) {
          setIsReplaySaved(replayId !== undefined)
        }
      })
      .catch(err => {
        logger.error(`Error checking replay library: ${getErrorStack(err)}`)
      })

    return () => {
      isMounted = false
    }
  }, [gameId])

  useEffect(() => {
    return () => {
      // This page instance is reused across game navigations, so an in-flight save for the
      // previous game must be aborted -- otherwise its stale onSuccess would mark the newly
      // displayed game's replay as saved.
      cancelSaveRef.current.abort()
      setIsSavingReplay(false)
    }
  }, [gameId])

  const headline = useMemo<string>(() => {
    if (game && !game.results) {
      return t('gameDetails.headlineInProgress', 'In progress…')
    } else if (
      selfUser &&
      game &&
      game.config.teams.some(team => team.some(p => !p.isComputer && p.id === selfUser.id))
    ) {
      const [, result] = game.results?.find(([id]) => id === selfUser.id) ?? []
      if (!result) {
        return ''
      }

      switch (result.result) {
        case 'win':
          return t('gameDetails.headlineVictory', 'Victory!')
        case 'loss':
          return t('gameDetails.headlineDefeat', 'Defeat!')
        case 'draw':
        case 'unknown':
          return t('gameDetails.headlineDraw', 'Draw!')
        default:
          result.result satisfies never
          return ''
      }
    }

    return t('gameDetails.headlineDefault', 'Results')
  }, [game, t, selfUser])

  const onWatchReplay = () => {
    if (!replayInfo || !IS_ELECTRON) return

    setIsDownloadingReplay(true)

    dispatch(
      watchReplayFromUrl(replayInfo, gameId, {
        onSuccess: () => {
          setIsDownloadingReplay(false)
        },
        onError: err => {
          setIsDownloadingReplay(false)
          logger.error(`Error watching replay: ${getErrorStack(err)}`)
          dispatch(
            openSimpleDialog(
              t('replays.watch.errorTitle', 'Error loading replay'),
              t(
                'replays.watch.errorBody',
                'There was a problem downloading or loading the replay. Please try again later.',
              ),
            ),
          )
        },
      }),
    )
  }

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

  const isLive = !game?.results

  const selfIsParticipant =
    !!selfUser &&
    !!game &&
    game.config.teams.some(team => team.some(p => !p.isComputer && p.id === selfUser.id))
  const reportCandidates = useMemo<SbUserId[]>(() => {
    if (!game || !selfUser) {
      return []
    }
    return game.config.teams
      .flat()
      .filter(p => !p.isComputer && p.id !== selfUser.id)
      .map(p => p.id)
  }, [game, selfUser])
  // Reporting is limited to finished games you played in, against another human player from it.
  const canReport = !isLive && selfIsParticipant && reportCandidates.length > 0

  let saveReplayLabel: string
  if (isSavingReplay) {
    saveReplayLabel = t('gameDetails.buttonSaveReplayLoading', 'Saving…')
  } else if (isReplaySaved) {
    saveReplayLabel = t('gameDetails.buttonReplaySaved', 'In library')
  } else {
    saveReplayLabel = t('gameDetails.buttonSaveReplay', 'Save replay')
  }

  return (
    <Container layoutScroll>
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
        <StatusRow>
          <LiveFinalIndicator $isLive={isLive}>
            {isLive ? t('gameDetails.statusLive', 'Live') : t('gameDetails.statusFinal', 'Final')}
          </LiveFinalIndicator>
          {game?.manuallyResolved ? (
            <StatusChip $color='var(--theme-on-surface-variant)'>
              {t('gameDetails.statusManuallyResolved', 'Manually resolved')}
            </StatusChip>
          ) : null}
          {canManageGameReports && game?.disputable ? (
            <StatusChip $color='var(--theme-amber)'>
              {t('gameDetails.statusDisputed', 'Disputed')}
            </StatusChip>
          ) : null}
        </StatusRow>
      </HeaderArea>
      <ButtonBar>
        {replayInfo && IS_ELECTRON ? (
          <OutlinedButton
            label={
              isDownloadingReplay
                ? t('gameDetails.buttonWatchReplayLoading', 'Loading…')
                : t('gameDetails.buttonWatchReplay', 'Watch replay')
            }
            iconStart={<MaterialIcon icon='play_circle' />}
            disabled={isDownloadingReplay}
            onClick={onWatchReplay}
          />
        ) : null}
        {replayInfo && IS_ELECTRON ? (
          <>
            <OutlinedButton
              ref={saveAnchor}
              label={saveReplayLabel}
              iconStart={<MaterialIcon icon={isReplaySaved ? 'check' : 'save'} />}
              disabled={isSavingReplay}
              onClick={openSaveMenu}
            />
            <Popover
              open={saveMenuOpen}
              onDismiss={closeSaveMenu}
              anchorX={saveAnchorX ?? 0}
              anchorY={saveAnchorY ?? 0}
              originX='left'
              originY='top'>
              <SaveReplayMenuContent
                replayInfo={replayInfo}
                onDismiss={closeSaveMenu}
                getAbortSignal={() => {
                  cancelSaveRef.current.abort()
                  const abortController = new AbortController()
                  cancelSaveRef.current = abortController
                  return abortController.signal
                }}
                onSaveStart={() => setIsSavingReplay(true)}
                onSaveSettled={result => {
                  setIsSavingReplay(false)
                  if (result) {
                    setIsReplaySaved(true)
                  }
                }}
                onUndone={() => setIsReplaySaved(false)}
              />
            </Popover>
          </>
        ) : null}
        {replayInfo ? (
          <OutlinedButton
            label={t('gameDetails.buttonDownloadReplay', 'Download replay')}
            iconStart={<MaterialIcon icon='download' />}
            onClick={() => {
              const a = document.createElement('a')
              a.href = replayInfo.url
              a.target = '_blank'
              a.click()
            }}
          />
        ) : null}
        {canReport ? (
          <OutlinedButton
            label={t('gameDetails.buttonReport', 'Report')}
            iconStart={<MaterialIcon icon='flag' />}
            onClick={() => {
              dispatch(
                openDialog({
                  type: DialogType.ReportGame,
                  initData: { gameId, reportedUserCandidates: reportCandidates },
                }),
              )
            }}
          />
        ) : null}
        <ButtonSpacer />
        {canManageGameReports && game?.disputable ? (
          <OutlinedButton
            label={t('gameDetails.buttonResolveResults', 'Resolve results')}
            onClick={() => {
              dispatch(
                openDialog({
                  type: DialogType.ResolveGameResults,
                  initData: { gameId },
                }),
              )
            }}
          />
        ) : null}
        {hasDebugPermission ? (
          <Tooltip text={t('gameDetails.buttonCopyGameId', 'Copy ID')} position='left'>
            <IconButton
              icon={<MaterialIcon icon='frame_source' />}
              onClick={() => {
                navigator.clipboard.writeText(gameId).catch(err => {
                  logger.error(`Error writing game ID to clipboard: ${getErrorStack(err)}`)
                })
              }}
            />
          </Tooltip>
        ) : null}
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

const StyledMapThumbnail = styled(ReduxMapThumbnail)`
  ${elevationPlus1};
  height: auto;
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
        // Results and the player config are written separately, so a result can reference a user
        // the config doesn't list (e.g. inconsistent/corrupted rows) -- drop those rather than
        // taking down the whole page.
        const entry = result.get(id)
        if (entry) {
          entry[1] = r
        }
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
        {map ? <StyledMapThumbnail mapId={map.id} size={MAP_SIZE} showInfoLayer /> : null}
      </MapContainer>

      {hasDebugPermission && debugInfo ? (
        <DebugInfoDisplay gameId={gameId} debugInfo={debugInfo} />
      ) : null}
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
      {config.isComputer ? (
        <StyledComputerAvatar />
      ) : (
        <PlayerAvatar user={user?.name ?? ''} image={user?.avatarUrl} />
      )}
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
      {/* Ratings (and rating changes) are zeroed by the server until placements complete, so the
          MMR portion is meaningless (and misleading) to show until then. */}
      {change.lifetimeGames >= NUM_PLACEMENT_MATCHES ? (
        <span>
          {roundRating} {t('gameDetails.summary.mmr', 'MMR')} (<NumberDelta delta={ratingChange} />)
        </span>
      ) : null}
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

const DebugInfoSection = styled(m.div)`
  grid-column: 1 / -1;
  width: 100%;
  margin-top: 24px;
`

const DebugCard = styled(m.div)`
  ${containerStyles(ContainerLevel.Normal)};
  /** NOTE(tec27): We set border radius + shadow via style to avoid issues with layout animations */
  padding: 16px;
`

const DebugSectionTitle = styled(m.div)`
  ${titleLarge};

  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;

  color: var(--theme-on-surface-variant);

  &:hover,
  &:focus-visible {
    color: var(--theme-on-surface);
    cursor: pointer;
    outline: none;
  }
`

const ExpandIconContainer = styled(m.div)`
  display: flex;
  flex-direction: column;
  justify-content: center;
`

const DebugCollapsibleContent = styled(m.div)<{ $open: boolean }>`
  height: ${props => (props.$open ? 'auto' : 0)};
  overflow: hidden;
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

const NetworkSessionLine = styled.div`
  ${bodyMedium};
  margin-bottom: 8px;
  color: var(--theme-on-surface);
  user-select: text;
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

/** Formats a relay-serving-history row's relay cell, e.g. `"us-east (50)"`, falling back to the
 * bare relay id when the coordinator recorded no region for it. */
function formatRelay(relayId: number, region: string | undefined): string {
  return region ? `${region} (${relayId})` : String(relayId)
}

const DEBUG_OPEN_TRANSITION: Transition = {
  type: 'spring',
  mass: 4,
  stiffness: 550,
  damping: 48,
}

const DEBUG_CLOSE_TRANSITION: Transition = {
  type: 'spring',
  mass: 4,
  stiffness: 700,
  damping: 100,
}

const SubmittedIcon = styledWithAttrs(MaterialIcon, { icon: 'check' })`
  color: var(--theme-positive);
`

const NotSubmittedIcon = styledWithAttrs(MaterialIcon, { icon: 'close' })`
  color: var(--theme-negative);
`

function DebugInfoDisplay({
  gameId,
  debugInfo,
}: {
  gameId: string
  debugInfo: ReadonlyDeep<GameDebugInfoJson>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const transition = open ? DEBUG_OPEN_TRANSITION : DEBUG_CLOSE_TRANSITION

  // Map replays by uploadedByUserId for quick lookup
  const replaysByUserId = useMemo(() => {
    const map = new Map<SbUserId, ReadonlyDeep<GameReplayDebugInfo>>()
    if (debugInfo.replays) {
      for (const replay of debugInfo.replays) {
        map.set(replay.uploadedByUserId, replay)
      }
    }
    return map
  }, [debugInfo.replays])

  const sortedReports = debugInfo.reportedResults.slice().sort((a, b) => {
    // Sort by reported time - earliest first, undefined/null last
    if (!a.reportedAt && !b.reportedAt) return 0
    if (!a.reportedAt) return 1
    if (!b.reportedAt) return -1
    return a.reportedAt - b.reportedAt
  })

  return (
    <DebugInfoSection layoutScroll>
      <DebugCard layout style={{ borderRadius: 4 }} transition={transition}>
        <DebugSectionTitle
          onClick={() => setOpen(open => !open)}
          onKeyPress={e => {
            console.dir(e)
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setOpen(open => !open)
            }
          }}
          layout
          transition={transition}
          tabIndex={0}>
          <span>{t('gameDetails.debugInfo.title', 'Debug Information')}</span>
          <ExpandIconContainer
            animate={{
              rotate: open ? -180 : 0,
            }}
            transition={transition}>
            <MaterialIcon icon={'expand_circle_down'} />
          </ExpandIconContainer>
        </DebugSectionTitle>
        <DebugCollapsibleContent $open={open} layout transition={transition}>
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
                    <th>{t('gameDetails.debugInfo.replay', 'Replay')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedReports.map(report => {
                    const replay = replaysByUserId.get(report.userId)
                    return (
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
                          {report.reportedResults ? <SubmittedIcon /> : <NotSubmittedIcon />}
                        </HasReportCell>
                        <td>
                          {report.reportedResults
                            ? getGameDurationString(report.reportedResults.time)
                            : '—'}
                        </td>
                        <td>
                          {replay ? (
                            <Tooltip
                              text={t('gameDetails.debugInfo.downloadReplay', 'Download replay')}
                              position='top'>
                              <IconButton
                                icon={<MaterialIcon icon='download' />}
                                title={t('gameDetails.debugInfo.downloadReplay', 'Download replay')}
                                onClick={() => {
                                  const a = document.createElement('a')
                                  a.href = replay.url
                                  a.target = '_blank'
                                  a.click()
                                }}
                              />
                            </Tooltip>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </DebugTable>
            </DebugTableContainer>
          </div>
          {sortedReports.some(r => r.reportedResults) && (
            <div>
              <DebugSubsectionTitle>
                {t('gameDetails.debugInfo.detailedResults', 'Detailed Individual Results')}
              </DebugSubsectionTitle>
              {sortedReports
                .filter(r => r.reportedResults)
                .map(report => (
                  <div key={report.userId} style={{ marginBottom: '16px' }}>
                    <ReportTitle>
                      <Trans t={t} i18nKey='gameDetails.debugInfo.reportTitle'>
                        Report from <ConnectedUsername userId={report.userId} />:
                      </Trans>
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
                          {report
                            .reportedResults!.playerResults.slice(0)
                            .sort(([idA], [idB]) => idA - idB)
                            .map(([playerId, playerResult]) => (
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
          {debugInfo.netcodeV2.session !== null && (
            <div>
              <DebugSubsectionTitle>
                {t('gameDetails.debugInfo.network.title', 'Network')}
              </DebugSubsectionTitle>
              <NetworkSessionLine>
                {t('gameDetails.debugInfo.network.session', 'Session: {{session}}', {
                  session: debugInfo.netcodeV2.session,
                })}
              </NetworkSessionLine>
              <DebugTableContainer>
                <DebugTable>
                  <thead>
                    <tr>
                      <th>{t('gameDetails.debugInfo.network.event', 'Event')}</th>
                      <th>{t('gameDetails.debugInfo.network.relay', 'Relay')}</th>
                      <th>{t('gameDetails.debugInfo.network.address', 'Address')}</th>
                      <th>{t('gameDetails.debugInfo.network.at', 'At')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debugInfo.netcodeV2.relays.map((event, i) => (
                      <tr key={i}>
                        {event.kind === 'home' ? (
                          <>
                            <td>{t('gameDetails.debugInfo.network.home', 'Home')}</td>
                            <td>{formatRelay(event.relayId, event.region)}</td>
                            <td>{event.relayAddr}</td>
                          </>
                        ) : (
                          <>
                            <td>{t('gameDetails.debugInfo.network.rehome', 'Rehome')}</td>
                            <td>
                              {event.deadRelayId} {'->'}{' '}
                              {formatRelay(event.newRelayId, event.newRelayRegion)}
                            </td>
                            <td>{event.newRelayAddr}</td>
                          </>
                        )}
                        <td>
                          <Tooltip text={longTimestampWithSeconds.format(event.at)} position='top'>
                            {longTimestamp.format(event.at)}
                          </Tooltip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DebugTable>
              </DebugTableContainer>
              <FlightRecordingsSection gameId={gameId} session={debugInfo.netcodeV2.session} />
            </div>
          )}
        </DebugCollapsibleContent>
      </DebugCard>
    </DebugInfoSection>
  )
}

type FlightBlobListState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; blobs: NetcodeV2FlightBlobInfo[] }
  | { status: 'error'; message: string }

/**
 * Lets an admin list and download a game's stored rally-point2 flight-recorder blobs (one per
 * relay that shipped one) through the server, which holds the tenant signing key — the UI
 * counterpart to running `deployment/coordinator/tools/fetch-flight.mjs` with the key copied off
 * the box.
 */
function FlightRecordingsSection({ gameId, session }: { gameId: string; session: number }) {
  const { t } = useTranslation()
  const [listState, setListState] = useState<FlightBlobListState>({ status: 'idle' })
  const [downloadingRelayId, setDownloadingRelayId] = useState<number>()

  const onListBlobs = () => {
    setListState({ status: 'loading' })
    fetchJson<NetcodeV2FlightBlobsResponse>(apiUrl`games/${gameId}/flight-recordings`)
      .then(response => {
        setListState({ status: 'loaded', blobs: response.blobs })
      })
      .catch((err: unknown) => {
        logger.error(`Error listing flight recordings for game ${gameId}: ${getErrorStack(err)}`)
        setListState({
          status: 'error',
          message: isFetchError(err)
            ? t(
                'gameDetails.debugInfo.network.flightRecordings.listError',
                'Failed to list recordings ({{status}})',
                { status: err.status },
              )
            : t(
                'gameDetails.debugInfo.network.flightRecordings.listErrorGeneric',
                'Failed to list recordings',
              ),
        })
      })
  }

  const onDownloadBlob = (relayId: number) => {
    setDownloadingRelayId(relayId)
    fetchJson<unknown>(apiUrl`games/${gameId}/flight-recordings/${relayId}`)
      .then(recording => {
        const blobUrl = URL.createObjectURL(
          new Blob([JSON.stringify(recording, null, 2)], { type: 'application/json' }),
        )
        try {
          const a = document.createElement('a')
          a.href = blobUrl
          a.download = `flight-${gameId}-relay-${relayId}.json`
          a.click()
        } finally {
          URL.revokeObjectURL(blobUrl)
        }
      })
      .catch((err: unknown) => {
        logger.error(
          `Error downloading flight recording for game ${gameId} relay ${relayId}: ` +
            getErrorStack(err),
        )
      })
      .finally(() => {
        setDownloadingRelayId(undefined)
      })
  }

  return (
    <div>
      <DebugSubsectionTitle>
        {t('gameDetails.debugInfo.network.flightRecordings.title', 'Flight recordings')}
      </DebugSubsectionTitle>
      <div style={{ marginBottom: '8px' }}>
        <OutlinedButton
          label={t('gameDetails.debugInfo.network.flightRecordings.list', 'List stored recordings')}
          onClick={onListBlobs}
          disabled={listState.status === 'loading'}
        />
      </div>
      {listState.status === 'error' && <NetworkSessionLine>{listState.message}</NetworkSessionLine>}
      {listState.status === 'loaded' && listState.blobs.length === 0 && (
        <NetworkSessionLine>
          {t(
            'gameDetails.debugInfo.network.flightRecordings.empty',
            'No stored recordings for session {{session}}',
            { session },
          )}
        </NetworkSessionLine>
      )}
      {listState.status === 'loaded' && listState.blobs.length > 0 && (
        <DebugTableContainer>
          <DebugTable>
            <thead>
              <tr>
                <th>{t('gameDetails.debugInfo.network.relay', 'Relay')}</th>
                <th>{t('gameDetails.debugInfo.network.flightRecordings.desync', 'Desync')}</th>
                <th>{t('gameDetails.debugInfo.network.flightRecordings.size', 'Size')}</th>
                <th>{t('gameDetails.debugInfo.network.flightRecordings.storedAt', 'Stored At')}</th>
                <th>
                  {t('gameDetails.debugInfo.network.flightRecordings.recording', 'Recording')}
                </th>
              </tr>
            </thead>
            <tbody>
              {listState.blobs.map(({ relayId, pinned, size, lastModifiedMs }) => (
                <tr key={relayId}>
                  <td>{relayId}</td>
                  <td>{pinned ? <MaterialIcon icon='check' /> : '—'}</td>
                  <td>
                    <Tooltip
                      text={t(
                        'gameDetails.debugInfo.network.flightRecordings.sizeTooltip',
                        'Compressed size at rest; the downloaded JSON will be larger',
                      )}
                      position='top'>
                      {prettyBytes(size)}
                    </Tooltip>
                  </td>
                  <td>
                    <Tooltip text={longTimestampWithSeconds.format(lastModifiedMs)} position='top'>
                      {longTimestamp.format(lastModifiedMs)}
                    </Tooltip>
                  </td>
                  <td>
                    <Tooltip
                      text={t(
                        'gameDetails.debugInfo.network.flightRecordings.download',
                        'Download recording',
                      )}
                      position='top'>
                      <IconButton
                        icon={<MaterialIcon icon='download' />}
                        title={t(
                          'gameDetails.debugInfo.network.flightRecordings.download',
                          'Download recording',
                        )}
                        disabled={downloadingRelayId === relayId}
                        onClick={() => onDownloadBlob(relayId)}
                      />
                    </Tooltip>
                  </td>
                </tr>
              ))}
            </tbody>
          </DebugTable>
        </DebugTableContainer>
      )}
    </div>
  )
}
