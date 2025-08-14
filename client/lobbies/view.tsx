import * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Route, Switch } from 'wouter'
import { assertUnreachable } from '../../common/assert-unreachable'
import { LobbyState } from '../../common/lobbies'
import { urlPath } from '../../common/urls'
import { useRequireLogin, useSelfUser } from '../auth/auth-utils'
import { navigateToGameResults } from '../games/action-creators'
import { ResultsSubPage } from '../games/results-sub-page'
import { MaterialIcon } from '../icons/material/material-icon'
import { openMapPreviewDialog } from '../maps/action-creators'
import { FilledButton } from '../material/button'
import { push, replace } from '../navigation/routing'
import LoadingIndicator from '../progress/dots'
import { usePrevious } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
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
  params: { lobby: string }
}

export function LobbyView(props: LobbyViewProps) {
  const dispatch = useAppDispatch()
  const routeLobby = decodeURIComponent(props.params.lobby)
  const inLobby = useAppSelector(s => s.lobby.inLobby)
  const lobbyName = useAppSelector(s => s.lobby.info.name)

  const prevRouteLobby = usePrevious(routeLobby)
  const prevInLobby = usePrevious(inLobby)
  const prevLobbyName = usePrevious(lobbyName)
  const isLeavingLobby =
    !inLobby && prevRouteLobby === routeLobby && prevInLobby && prevLobbyName === prevRouteLobby

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

    dispatch(getLobbyState(routeLobby))

    if (inLobby) {
      dispatch(activateLobby() as any)
    }

    return () => {
      dispatch(deactivateLobby() as any)
    }
  }, [dispatch, inLobby, routeLobby, isConnected])

  const isRedirecting = useRequireLogin()
  if (isRedirecting) {
    return undefined
  }

  return (
    <Switch>
      <Route path='/lobbies/:lobby'>
        <LobbyContent routeLobby={routeLobby} />
      </Route>
    </Switch>
  )
}

function LobbyContent({ routeLobby }: { routeLobby: string }) {
  const inLobby = useAppSelector(s => s.lobby.inLobby)
  const lobbyName = useAppSelector(s => s.lobby.info.name)

  if (!inLobby) {
    return <LobbyStateView routeLobby={routeLobby} />
  } else if (lobbyName !== routeLobby) {
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

function LobbyStateView({ routeLobby }: { routeLobby: string }) {
  const { t } = useTranslation()
  const lobby = useAppSelector(s => s.lobbyState.get(routeLobby))
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
        <LobbyStateContent state={lobby.state} routeLobby={routeLobby} />
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

function LobbyStateContent({ state, routeLobby }: { state: LobbyState; routeLobby: string }) {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  switch (state) {
    case 'nonexistent':
      return (
        <StateMessageLayout>
          <StateMessageIcon icon='other_houses' />
          <BodyLarge>
            {t('lobbies.state.nonexistent', 'Lobby not found. Would you like to create it?')}
          </BodyLarge>
          <StateMessageActionButton
            label={t('lobbies.createLobby.title', 'Create lobby')}
            iconStart={<MaterialIcon icon='add' />}
            onClick={() => push(urlPath`/play/lobbies/create/${routeLobby}`)}
          />
        </StateMessageLayout>
      )
    case 'exists':
      // TODO(tec27): Show a preview of the lobby (like what's shown in the lobby list). We don't
      // have a way to retrieve info about a single lobby in the lobby service and I don't want to
      // change that a bunch right now (it needs replacing), so just taking the simple approach for
      // now.
      // TODO(tec27): Also handle join errors better, we have no real way of responding to failure
      // here (like if the lobby is full)
      return (
        <StateMessageLayout>
          <StateMessageIcon icon='meeting_room' />
          <BodyLarge>
            {t(
              'lobbies.state.exists',
              "You're not currently in this lobby. Would you like to join it?",
            )}
          </BodyLarge>
          <StateMessageActionButton
            label={t('lobbies.joinLobby.action', 'Join lobby')}
            iconStart={<MaterialIcon icon='add' />}
            onClick={() => dispatch(joinLobby(routeLobby))}
          />
        </StateMessageLayout>
      )
    case 'countingDown':
    case 'hasStarted':
      return (
        <StateMessageLayout>
          <StateMessageIcon icon='avg_pace' />
          <BodyLarge>
            {t('lobbies.state.started', 'This lobby has already started and cannot be joined.')}
          </BodyLarge>
        </StateMessageLayout>
      )
    default:
      return assertUnreachable(state)
  }
}
