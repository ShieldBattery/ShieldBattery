import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Route, Switch } from 'wouter'
import { assertUnreachable } from '../../common/assert-unreachable'
import { getErrorStack } from '../../common/errors'
import { LobbyState } from '../../common/lobbies'
import { LobbyJoinErrorCode } from '../../common/lobbies/lobby-network'
import { makeSbLobbyId, SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { useRequireLogin, useSelfUser } from '../auth/auth-utils'
import { openDialog, openSimpleDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { ThunkAction } from '../dispatch-registry'
import { navigateToGameResults, viewGame } from '../games/action-creators'
import { ResultsSubPage } from '../games/results-sub-page'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { FilledButton } from '../material/button'
import { push, replace } from '../navigation/routing'
import { RequestHandlingSpec } from '../network/abortable-thunk'
import LoadingIndicator, { LoadingDotsArea } from '../progress/dots'
import { usePrevious } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { watchReplayFromUrl } from '../replays/action-creators'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { healthChecked } from '../starcraft/health-checked'
import { BodyLarge } from '../styles/typography'
import {
  activateLobby,
  addComputer,
  banPlayer,
  cancelCountdown,
  changeSlot,
  closeSlot,
  deactivateLobby,
  getLobbyState,
  joinLobby,
  kickPlayer,
  leaveLobby,
  makeObserver,
  openSlot,
  removeObserver,
  sendChat,
  setRace,
  setReady,
  shuffleSlots,
  startCountdown,
  swapTeams,
} from './action-creators'
import { lobbyJoinErrorCode, lobbyJoinErrorMessage } from './lobby-join-errors'
import { isInLobby } from './lobby-reducer'
import { LobbySummaryDetails, LobbySummaryLoadState, useLobbySummary } from './lobby-summary'
import { navigateToLobby, useCorrectLobbySlug } from './lobby-url'
import { LobbyRoom } from './room/lobby-room'
import { TeamArrangement } from './room/room-parts'
import { SlotAction } from './room/room-rail'

const LoadingArea = styled.div`
  height: 32px;
  display: flex;
  align-items: center;
`

const PreLobbyArea = styled.div`
  display: flex;
  flex-direction: column;
  padding: 0 16px;
`

export interface LobbyViewProps {
  params: { lobbyId: string }
}

export function LobbyView(props: LobbyViewProps) {
  const dispatch = useAppDispatch()
  const routeLobbyId = makeSbLobbyId(props.params.lobbyId)
  const inLobby = useAppSelector(s => isInLobby(s.lobby))
  const lobbyId = useAppSelector(s => s.lobby.info.id)

  const lobbyName = useAppSelector(s =>
    isInLobby(s.lobby) && s.lobby.info.id === routeLobbyId ? s.lobby.info.name : undefined,
  )

  useCorrectLobbySlug(routeLobbyId, lobbyName)

  const prevRouteLobbyId = usePrevious(routeLobbyId)
  const prevInLobby = usePrevious(inLobby)
  const prevLobbyId = usePrevious(lobbyId)
  const isLeavingLobby =
    !inLobby && prevRouteLobbyId === routeLobbyId && prevInLobby && prevLobbyId === prevRouteLobbyId

  const isActiveGame = useAppSelector(s => s.activeGame.isActive)
  const prevIsActiveGame = usePrevious(isActiveGame)
  const gameClientGameId = useAppSelector(s => s.gameClient.gameId)
  const prevGameClientGameId = usePrevious(gameClientGameId)
  const currentLobbyName = useAppSelector(s => s.lobby.info.name)

  useEffect(() => {
    // TODO(tec27): This check seems kind of bad because you could (theoretically) get kicked from
    // a lobby on the same render you launch an active game? Ideally this would check that this
    // specific lobby is the active one (or we move the 'active game' stuff out of the lobby flow
    // entirely, which is probably better)
    if (isLeavingLobby && !isActiveGame) {
      push('/')
    }
  }, [isLeavingLobby, isActiveGame])
  useEffect(() => {
    if (!isActiveGame && prevIsActiveGame) {
      if (inLobby) {
        // The lobby survives its own game, so land back in it rather than the results screen --
        // its regroup message links to the results for anyone who wants them.
        navigateToLobby(lobbyId, currentLobbyName, replace)
      } else if (prevGameClientGameId) {
        navigateToGameResults(
          prevGameClientGameId,
          true /* isPostGame */,
          ResultsSubPage.Summary,
          replace,
        )
      } else {
        replace('/')
      }
    }
  }, [isActiveGame, prevGameClientGameId, prevIsActiveGame, inLobby, lobbyId, currentLobbyName])

  const isConnected = useAppSelector(s => s.network.isConnected)
  useEffect(() => {
    if (!isConnected) {
      return () => {}
    }

    dispatch(getLobbyState(routeLobbyId))

    if (inLobby) {
      dispatch(activateLobby())
    }

    return () => {
      dispatch(deactivateLobby())
    }
  }, [dispatch, inLobby, routeLobbyId, isConnected])

  const isRedirecting = useRequireLogin()
  if (isRedirecting) {
    return undefined
  }

  return (
    <Switch>
      <Route path='/lobbies/:lobbyId/:slugStr?'>
        <LobbyContent routeLobbyId={routeLobbyId} />
      </Route>
    </Switch>
  )
}

function LobbyContent({ routeLobbyId }: { routeLobbyId: SbLobbyId }) {
  const inLobby = useAppSelector(s => isInLobby(s.lobby))
  const lobbyId = useAppSelector(s => s.lobby.info.id)

  if (!inLobby) {
    return <LobbyStateView routeLobbyId={routeLobbyId} />
  } else if (lobbyId !== routeLobbyId) {
    return <InAnotherLobbyView />
  } else {
    return <ConnectedLobby />
  }
}

/**
 * Loads a lobby game's record — which is what carries the replay the viewer is allowed to download,
 * if the game has one at all — and then plays that replay.
 *
 * A lobby's series names only game ids, so the record has to be fetched before there's anything to
 * watch. A game with no replay on its record resolves as an error, since from the viewer's side
 * asking to watch it and getting nothing back is a failure either way.
 */
function watchLobbyGameReplay(gameId: string, spec: RequestHandlingSpec<void>): ThunkAction {
  return (dispatch, getState) => {
    dispatch(
      viewGame(gameId, {
        signal: spec.signal,
        onSuccess: () => {
          const replayInfo = getState().games.replayInfoById.get(gameId)
          if (!replayInfo) {
            spec.onError(new Error(`no replay is available for game ${gameId}`))
            return
          }

          dispatch(watchReplayFromUrl(replayInfo, gameId, spec))
        },
        onError: spec.onError,
      }),
    )
  }
}

function ConnectedLobby() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()!
  const isViewerReady = useAppSelector(s => s.lobby.readyUserIds.includes(selfUser.id))

  const onWatchReplay = (gameId: string) => {
    dispatch(
      watchLobbyGameReplay(gameId, {
        onSuccess: () => {},
        onError: err => {
          logger.error(`Error watching replay: ${getErrorStack(err)}`)
          dispatch(
            openSimpleDialog(
              t('replays.watch.errorTitle', 'Error loading replay'),
              err?.message ??
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

  return (
    <LobbyRoom
      viewerId={selfUser.id}
      onSendChatMessage={message => {
        dispatch(sendChat(message))
      }}
      onSetRace={(slotId, race) => {
        dispatch(setRace(slotId, race))
      }}
      onSitInSlot={slotId => {
        dispatch(changeSlot(slotId))
      }}
      onLeaveLobby={() => {
        dispatch(leaveLobby())
      }}
      onToggleReady={() => {
        dispatch(setReady(!isViewerReady))
      }}
      onStartGame={() => {
        dispatch(startCountdown())
      }}
      onForceStart={() => {
        dispatch(startCountdown(true))
      }}
      onCancelCountdown={() => {
        dispatch(cancelCountdown())
      }}
      onSlotAction={(action, slotId) => {
        switch (action) {
          case SlotAction.Close:
            dispatch(closeSlot(slotId))
            break
          case SlotAction.Open:
            dispatch(openSlot(slotId))
            break
          case SlotAction.AddComputer:
            dispatch(addComputer(slotId))
            break
          case SlotAction.Kick:
            dispatch(kickPlayer(slotId))
            break
          case SlotAction.Ban:
            dispatch(banPlayer(slotId))
            break
          case SlotAction.MakeObserver:
            dispatch(makeObserver(slotId))
            break
          case SlotAction.RemoveObserver:
            dispatch(removeObserver(slotId))
            break
          case SlotAction.Move:
            dispatch(openDialog({ type: DialogType.MoveSlot, initData: { fromSlotId: slotId } }))
            break
          default:
            assertUnreachable(action)
        }
      }}
      onArrangeTeams={arrangement => {
        switch (arrangement) {
          case TeamArrangement.Swap:
            dispatch(swapTeams())
            break
          case TeamArrangement.Shuffle:
            dispatch(shuffleSlots())
            break
          default:
            assertUnreachable(arrangement)
        }
      }}
      onWatchReplay={onWatchReplay}
      onViewGameSummary={gameId => {
        navigateToGameResults(gameId)
      }}
    />
  )
}

function InAnotherLobbyView() {
  const { t } = useTranslation()

  return (
    <PreLobbyArea as='p'>
      {t('lobbies.errors.alreadyInLobby', "You're already in another lobby.")}
    </PreLobbyArea>
  )
}

function LobbyStateView({ routeLobbyId }: { routeLobbyId: SbLobbyId }) {
  const { t } = useTranslation()
  const lobby = useAppSelector(s => s.lobbyState.get(routeLobbyId))
  if (!lobby) {
    return null
  }

  let preLobbyAreaContents: React.ReactNode
  if (!lobby.state && !lobby.error) {
    if (lobby.isRequesting) {
      preLobbyAreaContents = (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    } else {
      preLobbyAreaContents = (
        <span>{t('lobbies.errors.load', 'There was a problem loading this lobby')}</span>
      )
    }
  } else if (lobby.state) {
    preLobbyAreaContents = (
      <>
        {lobby.isRequesting ? (
          <LoadingArea>
            <LoadingIndicator />
          </LoadingArea>
        ) : null}
        <LobbyStateContent state={lobby.state} routeLobbyId={routeLobbyId} />
      </>
    )
  } else if (lobby.error) {
    preLobbyAreaContents = (
      <>
        {lobby.isRequesting ? (
          <LoadingArea>
            <LoadingIndicator />
          </LoadingArea>
        ) : null}
        <p>{t('lobbies.errors.load', 'There was a problem loading this lobby')}</p>
      </>
    )
  }

  return <PreLobbyArea>{preLobbyAreaContents}</PreLobbyArea>
}

const StateMessageLayout = styled.div`
  padding: 16px 0;

  display: flex;
  flex-direction: column;
  align-items: center;

  gap: 16px;
`

const StateMessageIcon = styled(MaterialIcon).attrs({
  size: 96,
  filled: false,
})`
  color: var(--theme-on-surface-variant);
`

const StateMessageActionButton = styled(FilledButton)`
  margin-top: 32px;
`

function LobbyStateContent({
  state,
  routeLobbyId,
}: {
  state: LobbyState
  routeLobbyId: SbLobbyId
}) {
  const { t } = useTranslation()
  switch (state) {
    case 'nonexistent':
      return (
        <StateMessageLayout>
          <StateMessageIcon icon='other_houses' />
          <BodyLarge>
            {t('lobbies.state.nonexistent', 'Lobby not found. Would you like to create a new one?')}
          </BodyLarge>
          <StateMessageActionButton
            label={t('lobbies.createLobby.title', 'Create lobby')}
            iconStart={<MaterialIcon icon='add' />}
            onClick={() => push('/play/lobbies/create')}
            testName='create-lobby-button'
          />
        </StateMessageLayout>
      )
    case 'exists':
      return <JoinableLobbyView key={routeLobbyId} routeLobbyId={routeLobbyId} />
    case 'countingDown':
    case 'hasStarted':
      return <LobbyStartedMessage />
    default:
      return assertUnreachable(state)
  }
}

function LobbyStartedMessage() {
  const { t } = useTranslation()

  return (
    <StateMessageLayout>
      <StateMessageIcon icon='avg_pace' />
      <BodyLarge>
        {t('lobbies.state.started', 'This lobby has already started and cannot be joined.')}
      </BodyLarge>
      <BrowseLobbiesButton />
    </StateMessageLayout>
  )
}

function BrowseLobbiesButton() {
  const { t } = useTranslation()

  return (
    <StateMessageActionButton
      label={t('lobbies.joinLobby.browseLobbies', 'Browse lobbies')}
      iconStart={<MaterialIcon icon='list' />}
      onClick={() => push('/play/lobbies')}
    />
  )
}

const JoinPreviewLayout = styled.div`
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 16px 0;

  display: flex;
  flex-direction: column;
  align-items: center;
`

/**
 * Renders the join interstitial for a lobby that isn't the current user's active lobby: a preview
 * of the lobby (fetched from the unauthenticated summary endpoint, same as the logged-out landing
 * page) plus a button to join it. Falls back to a bare join prompt if the preview fails to load
 * (the lobby may well still be joinable), and to a "no longer open" or "already started" message
 * if the preview or the join attempt itself finds the lobby gone or started.
 */
function JoinableLobbyView({ routeLobbyId }: { routeLobbyId: SbLobbyId }) {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [summary, refreshSummary] = useLobbySummary(routeLobbyId)
  const [isJoining, setIsJoining] = useState(false)
  const [lobbyGone, setLobbyGone] = useState(false)
  const [lobbyStarted, setLobbyStarted] = useState(false)

  // The parent view can only correct the URL slug from the lobby name in the store, which isn't
  // populated until the user is actually in the lobby -- the summary lets this page fix a stale or
  // hand-edited slug the same way the logged-out landing page does.
  useCorrectLobbySlug(
    routeLobbyId,
    summary?.status === 'loaded' ? summary.data.summary.name : undefined,
  )

  const onJoinClick = () => {
    setIsJoining(true)
    dispatch(
      joinLobby(routeLobbyId, undefined, {
        onSuccess: () => {},
        onError: (err: unknown) => {
          setIsJoining(false)

          switch (lobbyJoinErrorCode(err)) {
            case LobbyJoinErrorCode.NoLongerOpen:
              setLobbyGone(true)
              break
            case LobbyJoinErrorCode.AlreadyStarted:
              setLobbyStarted(true)
              break
            default:
              snackbarController.showSnackbar(lobbyJoinErrorMessage(err, t))
              break
          }

          refreshSummary()
        },
      }),
    )
  }

  return (
    <JoinableLobbyContent
      summary={summary}
      lobbyGone={lobbyGone}
      lobbyStarted={lobbyStarted}
      isJoining={isJoining}
      onJoinClick={healthChecked(onJoinClick)}
    />
  )
}

/**
 * The presentational part of {@link JoinableLobbyView}: renders the loading/gone/started/error/
 * loaded states without doing any fetching or dispatching itself, so it can be driven directly
 * (e.g. from a devonly test page) without racing a real lobby or join attempt.
 */
export function JoinableLobbyContent({
  summary,
  lobbyGone,
  lobbyStarted,
  isJoining,
  onJoinClick,
}: {
  summary: LobbySummaryLoadState | undefined
  lobbyGone: boolean
  lobbyStarted: boolean
  isJoining: boolean
  onJoinClick: () => void
}) {
  const { t } = useTranslation()

  // NOTE: The button stays enabled even if the summary reports 0 open slots — the summary is a
  // snapshot, so fullness may have changed since it loaded. The server arbitrates on click, and a
  // still-full lobby gets a specific error message from the join attempt.
  const joinButton = (
    <StateMessageActionButton
      label={t('lobbies.joinLobby.action', 'Join lobby')}
      iconStart={<MaterialIcon icon='add' />}
      onClick={onJoinClick}
      disabled={isJoining}
      testName='join-lobby-button'
    />
  )

  if (lobbyStarted) {
    return <LobbyStartedMessage />
  }

  if (lobbyGone || summary?.status === 'notFound') {
    return (
      <StateMessageLayout>
        <StateMessageIcon icon='other_houses' />
        <BodyLarge>{t('lobbies.summary.noLongerOpen', 'This lobby is no longer open.')}</BodyLarge>
        <BrowseLobbiesButton />
      </StateMessageLayout>
    )
  }

  if (!summary) {
    return <LoadingDotsArea />
  }

  if (summary.status === 'error') {
    return (
      <StateMessageLayout>
        <StateMessageIcon icon='meeting_room' />
        <BodyLarge>
          {t(
            'lobbies.state.exists',
            "You're not currently in this lobby. Would you like to join it?",
          )}
        </BodyLarge>
        {joinButton}
      </StateMessageLayout>
    )
  }

  return (
    <JoinPreviewLayout>
      <LobbySummaryDetails summary={summary.data} />
      {joinButton}
    </JoinPreviewLayout>
  )
}
