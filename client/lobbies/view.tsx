import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { styled } from 'styled-components'
import { Route, Switch } from 'wouter'
import { assertUnreachable } from '../../common/assert-unreachable.js'
import { LobbyState } from '../../common/lobbies/index.js'
import { RaceChar } from '../../common/races.js'
import { openOverlay } from '../activities/action-creators.js'
import { ActivityOverlayType } from '../activities/activity-overlay-type.js'
import { useSelfUser } from '../auth/auth-utils.js'
import { navigateToGameResults } from '../games/action-creators.js'
import { ResultsSubPage } from '../games/results-sub-page.js'
import { MaterialIcon } from '../icons/material/material-icon.js'
import { openMapPreviewDialog, toggleFavoriteMap } from '../maps/action-creators.js'
import { RaisedButton } from '../material/button.js'
import { push, replace } from '../navigation/routing.js'
import LoadingIndicator from '../progress/dots.js'
import { useAppDispatch, useAppSelector } from '../redux-hooks.js'
import { usePrevious, useStableCallback } from '../state-hooks.js'
import { colorTextFaint } from '../styles/colors.js'
import { Subtitle1 } from '../styles/typography.js'
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
} from './action-creators.js'
import ActiveLobby from './active-lobby.js'
import LoadingScreen from './loading.js'
import Lobby from './lobby.js'

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
    // specific lobby is the active one (or we move the 'actiev game' stuff out of the lobby flow
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

  useEffect(() => {
    dispatch(getLobbyState(routeLobby))

    if (inLobby) {
      dispatch(activateLobby() as any)
    }

    return () => {
      dispatch(deactivateLobby() as any)
    }
  }, [dispatch, inLobby, routeLobby])

  return (
    <Switch>
      <Route path='/lobbies/:lobby/loading-game'>
        <LobbyLoadingScreen />
      </Route>
      <Route path='/lobbies/:lobby/active-game'>
        <ActiveLobbyGameScreen />
      </Route>
      <Route path='/lobbies/:lobby'>
        <LobbyContent routeLobby={routeLobby} />
      </Route>
    </Switch>
  )
}

function LobbyLoadingScreen() {
  const isLoading = useAppSelector(s => s.lobby.info.isLoading)
  const lobbyInfo = useAppSelector(s => s.lobby.info)
  const gameClientStatus = useAppSelector(s => s.gameClient.status)
  const user = useSelfUser()

  return isLoading ? (
    <LoadingScreen lobby={lobbyInfo} gameStatus={gameClientStatus} user={user} />
  ) : null
}

function ActiveLobbyGameScreen() {
  const hasActiveGame = useAppSelector(s => s.activeGame.isActive)
  const activeGameLobby = useAppSelector(s =>
    s.activeGame.info?.type === 'lobby' ? s.activeGame.info.extra.lobby.info : undefined,
  )

  return hasActiveGame && activeGameLobby ? <ActiveLobby lobby={activeGameLobby} /> : null
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
  const chat = useAppSelector(s => s.lobby.chat)
  const isFavoritingMap = useAppSelector(s =>
    lobby.map ? s.maps.favoriteStatusRequests.has((lobby.map as any).id) : false,
  )

  const onLeaveLobbyClick = useStableCallback(() => {
    dispatch(leaveLobby())
  })
  const onAddComputer = useStableCallback((slotId: string) => {
    dispatch(addComputer(slotId))
  })
  const onSwitchSlot = useStableCallback((slotId: string) => {
    dispatch(changeSlot(slotId))
  })
  const onOpenSlot = useStableCallback((slotId: string) => {
    dispatch(openSlot(slotId))
  })
  const onCloseSlot = useStableCallback((slotId: string) => {
    dispatch(closeSlot(slotId))
  })
  const onKickPlayer = useStableCallback((slotId: string) => {
    dispatch(kickPlayer(slotId))
  })
  const onBanPlayer = useStableCallback((slotId: string) => {
    dispatch(banPlayer(slotId))
  })
  const onMakeObserver = useStableCallback((slotId: string) => {
    dispatch(makeObserver(slotId))
  })
  const onRemoveObserver = useStableCallback((slotId: string) => {
    dispatch(removeObserver(slotId))
  })
  const onSetRace = useStableCallback((slotId: string, race: RaceChar) => {
    dispatch(setRace(slotId, race))
  })
  const onSendChatMessage = useStableCallback((message: string) => {
    dispatch(sendChat(message))
  })
  const onStartGame = useStableCallback(() => {
    dispatch(startCountdown())
  })
  const onMapPreview = useStableCallback(() => {
    dispatch(openMapPreviewDialog((lobby.map as any).id))
  })
  const onToggleFavoriteMap = useStableCallback(() => {
    dispatch(toggleFavoriteMap(lobby.map as any))
  })

  return (
    <Lobby
      lobby={lobby}
      chat={chat}
      user={selfUser!}
      isFavoritingMap={isFavoritingMap}
      onLeaveLobbyClick={onLeaveLobbyClick}
      onAddComputer={onAddComputer}
      onSetRace={onSetRace}
      onSwitchSlot={onSwitchSlot}
      onOpenSlot={onOpenSlot}
      onCloseSlot={onCloseSlot}
      onKickPlayer={onKickPlayer}
      onBanPlayer={onBanPlayer}
      onMakeObserver={onMakeObserver}
      onRemoveObserver={onRemoveObserver}
      onStartGame={onStartGame}
      onSendChatMessage={onSendChatMessage}
      onMapPreview={onMapPreview}
      onToggleFavoriteMap={onToggleFavoriteMap}
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
  color: ${colorTextFaint};
`

const StateMessageActionButton = styled(RaisedButton)`
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
          <Subtitle1>
            {t('lobbies.state.nonexistent', 'Lobby not found. Would you like to create it?')}
          </Subtitle1>
          <StateMessageActionButton
            label={t('lobbies.createLobby.title', 'Create lobby')}
            iconStart={<MaterialIcon icon='add' />}
            onClick={() =>
              dispatch(
                openOverlay({
                  type: ActivityOverlayType.Lobby,
                  initData: { creating: true, initName: routeLobby },
                }),
              )
            }
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
          <Subtitle1>
            {t(
              'lobbies.state.exists',
              "You're not currently in this lobby. Would you like to join it?",
            )}
          </Subtitle1>
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
          <Subtitle1>
            {t('lobbies.state.started', 'This lobby has already started and cannot be joined.')}
          </Subtitle1>
        </StateMessageLayout>
      )
    default:
      return assertUnreachable(state)
  }
}
