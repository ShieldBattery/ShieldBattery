import { InvokeError } from 'nydus-client'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Route, Switch } from 'wouter'
import { assertUnreachable } from '../../common/assert-unreachable'
import { LobbyState } from '../../common/lobbies'
import { LobbyJoinErrorCode } from '../../common/lobbies/lobby-network'
import { makeSbLobbyId, SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { useRequireLogin, useSelfUser } from '../auth/auth-utils'
import { navigateToGameResults } from '../games/action-creators'
import { ResultsSubPage } from '../games/results-sub-page'
import { MaterialIcon } from '../icons/material/material-icon'
import { openMapPreviewDialog } from '../maps/action-creators'
import { FilledButton } from '../material/button'
import { push, replace } from '../navigation/routing'
import LoadingIndicator, { LoadingDotsArea } from '../progress/dots'
import { usePrevious } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { healthChecked } from '../starcraft/health-checked'
import { BodyLarge } from '../styles/typography'
import {
  activateLobby,
  addComputer,
  banPlayer,
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
  startCountdown,
} from './action-creators'
import LobbyComponent from './lobby'
import { LobbySummaryDetails, useLobbySummary } from './lobby-summary'
import { useCorrectLobbySlug } from './lobby-url'

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
  const inLobby = useAppSelector(s => s.lobby.inLobby)
  const lobbyId = useAppSelector(s => s.lobby.info.id)

  const lobbyName = useAppSelector(s =>
    s.lobby.inLobby && s.lobby.info.id === routeLobbyId ? s.lobby.info.name : undefined,
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
      if (prevGameClientGameId) {
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
  }, [isActiveGame, prevGameClientGameId, prevIsActiveGame])

  const isConnected = useAppSelector(s => s.network.isConnected)
  useEffect(() => {
    if (!isConnected) {
      return () => {}
    }

    dispatch(getLobbyState(routeLobbyId))

    if (inLobby) {
      dispatch(activateLobby() as any)
    }

    return () => {
      dispatch(deactivateLobby() as any)
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
  const inLobby = useAppSelector(s => s.lobby.inLobby)
  const lobbyId = useAppSelector(s => s.lobby.info.id)

  if (!inLobby) {
    return <LobbyStateView routeLobbyId={routeLobbyId} />
  } else if (lobbyId !== routeLobbyId) {
    return <InAnotherLobbyView />
  } else {
    return <ConnectedLobby />
  }
}

function ConnectedLobby() {
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const lobby = useAppSelector(s => s.lobby.info)
  const loadingState = useAppSelector(s => s.lobby.loadingState)
  const chat = useAppSelector(s => s.lobby.chat)

  return (
    <LobbyComponent
      lobby={lobby}
      loadingState={loadingState}
      chat={chat}
      user={selfUser!}
      onLeaveLobbyClick={() => {
        dispatch(leaveLobby())
      }}
      onAddComputer={slotId => {
        dispatch(addComputer(slotId))
      }}
      onSetRace={(slotId, race) => {
        dispatch(setRace(slotId, race))
      }}
      onSwitchSlot={slotId => {
        dispatch(changeSlot(slotId))
      }}
      onOpenSlot={slotId => {
        dispatch(openSlot(slotId))
      }}
      onCloseSlot={slotId => {
        dispatch(closeSlot(slotId))
      }}
      onKickPlayer={slotId => {
        dispatch(kickPlayer(slotId))
      }}
      onBanPlayer={slotId => {
        dispatch(banPlayer(slotId))
      }}
      onMakeObserver={slotId => {
        dispatch(makeObserver(slotId))
      }}
      onRemoveObserver={slotId => {
        dispatch(removeObserver(slotId))
      }}
      onStartGame={() => {
        dispatch(startCountdown())
      }}
      onSendChatMessage={message => {
        dispatch(sendChat(message))
      }}
      onMapPreview={() => {
        dispatch(openMapPreviewDialog(lobby.map!.id))
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
    </StateMessageLayout>
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
  const summary = useLobbySummary(routeLobbyId)
  const [isJoining, setIsJoining] = useState(false)
  const [lobbyGone, setLobbyGone] = useState(false)
  const [lobbyStarted, setLobbyStarted] = useState(false)

  const onJoinClick = () => {
    setIsJoining(true)
    dispatch(
      joinLobby(routeLobbyId, {
        onError: (err: unknown) => {
          setIsJoining(false)

          const code = err instanceof InvokeError ? err.body?.code : undefined
          switch (code) {
            case LobbyJoinErrorCode.NoLongerOpen:
              setLobbyGone(true)
              break
            case LobbyJoinErrorCode.Full:
              snackbarController.showSnackbar(
                t('lobbies.joinLobby.errorFull', 'This lobby is full.'),
              )
              break
            case LobbyJoinErrorCode.Banned:
              snackbarController.showSnackbar(
                t('lobbies.joinLobby.errorBanned', "You've been banned from this lobby."),
              )
              break
            case LobbyJoinErrorCode.AlreadyStarted:
              setLobbyStarted(true)
              break
            case LobbyJoinErrorCode.AlreadyInActivity:
              snackbarController.showSnackbar(
                t(
                  'lobbies.joinLobby.errorAlreadyInActivity',
                  'You are already in a game, searching for a match, or in another lobby.',
                ),
              )
              break
            default:
              snackbarController.showSnackbar(
                t(
                  'lobbies.joinLobby.errorGeneric',
                  'Something went wrong while joining the lobby. Please try again.',
                ),
              )
              break
          }
        },
      }),
    )
  }

  const joinButton = (
    <StateMessageActionButton
      label={t('lobbies.joinLobby.action', 'Join lobby')}
      iconStart={<MaterialIcon icon='add' />}
      onClick={healthChecked(onJoinClick)}
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
        <StateMessageActionButton
          label={t('lobbies.joinLobby.browseLobbies', 'Browse lobbies')}
          iconStart={<MaterialIcon icon='list' />}
          onClick={() => push('/play/lobbies')}
        />
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
