import { NydusClient, RouteHandler } from 'nydus-client'
import { TypedIpcRenderer } from '../../common/ipc'
import { LobbyEvent } from '../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { urlPath } from '../../common/urls'
import {
  LOBBIES_COUNT_UPDATE,
  LOBBIES_LIST_UPDATE,
  LOBBY_INIT_DATA,
  LOBBY_UPDATE_BAN,
  LOBBY_UPDATE_BAN_SELF,
  LOBBY_UPDATE_CHAT_MESSAGE,
  LOBBY_UPDATE_COUNTDOWN_CANCELED,
  LOBBY_UPDATE_COUNTDOWN_START,
  LOBBY_UPDATE_COUNTDOWN_TICK,
  LOBBY_UPDATE_GAME_STARTED,
  LOBBY_UPDATE_HOST_CHANGE,
  LOBBY_UPDATE_KICK,
  LOBBY_UPDATE_KICK_SELF,
  LOBBY_UPDATE_LEAVE,
  LOBBY_UPDATE_LEAVE_SELF,
  LOBBY_UPDATE_LOADING_CANCELED,
  LOBBY_UPDATE_LOADING_START,
  LOBBY_UPDATE_RACE_CHANGE,
  LOBBY_UPDATE_SLOT_CHANGE,
  LOBBY_UPDATE_SLOT_CREATE,
  LOBBY_UPDATE_STATUS,
} from '../actions'
import { audioManager, AvailableSound, FadeableSound } from '../audio/audio-manager'
import { closeDialog, openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { dispatch, Dispatchable } from '../dispatch-registry'
import windowFocus from '../dom/window-focus'
import i18n from '../i18n/i18next'
import { replace } from '../navigation/routing'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'

const ipcRenderer = new TypedIpcRenderer()

interface CountdownState {
  timer: ReturnType<typeof setInterval> | undefined
  sound: FadeableSound | undefined
}

const countdownState: CountdownState = {
  timer: undefined,
  sound: undefined,
}

function clearCountdownTimer() {
  const { timer, sound } = countdownState
  if (timer) {
    clearInterval(timer)
    countdownState.timer = undefined
  }
  if (sound) {
    sound.fadeOut(0.5)
    countdownState.sound = undefined
  }
}

type EventToActionMap = {
  [E in LobbyEvent['type']]: (
    lobbyId: SbLobbyId,
    event: Extract<LobbyEvent, { type: E }>,
  ) => Dispatchable | void
}

const eventToAction: EventToActionMap = {
  init: (lobbyId, event) => {
    clearCountdownTimer()
    const { hash, mapData, mapUrl } = event.lobby.map
    ipcRenderer.invoke('mapStoreDownloadMap', hash, mapData.format, mapUrl!)?.catch(err => {
      // TODO(tec27): Report this to the server so the loading is canceled immediately

      // This is already logged to our file by the map store, so we just log it to the console for
      // easy visibility during development
      console.error('Error downloading map: ' + err.stack)
    })

    return {
      type: LOBBY_INIT_DATA,
      payload: event,
    } as any
  },

  diff: (lobbyId, event) => dispatch => {
    for (const diffEvent of event.diffEvents) {
      const diffAction = eventToAction[diffEvent.type]!(lobbyId, diffEvent as any)
      if (diffAction) dispatch(diffAction)
    }
  },

  slotCreate: (lobbyId, event) => {
    if (event.slot.type === 'human') {
      audioManager.playSound(AvailableSound.JoinAlert)
      ipcRenderer.send('userAttentionRequired')
    }

    return {
      type: LOBBY_UPDATE_SLOT_CREATE,
      payload: event,
    } as any
  },

  raceChange: (lobbyId, event) =>
    ({
      type: LOBBY_UPDATE_RACE_CHANGE,
      payload: event,
    }) as any,

  leave: (lobbyId, event) => (dispatch, getState) => {
    const { auth } = getState()

    const user = auth.self!.user.id
    if (user === event.player.userId) {
      // The leaver was me all along!!!
      clearCountdownTimer()
      dispatch({
        type: LOBBY_UPDATE_LEAVE_SELF,
      } as any)
    } else {
      dispatch({
        type: LOBBY_UPDATE_LEAVE,
        payload: event,
      } as any)
    }
  },

  kick: (lobbyId, event) => (dispatch, getState) => {
    const { auth } = getState()

    const user = auth.self!.user.id
    if (user === event.player.userId) {
      // We have been kicked from a lobby
      clearCountdownTimer()
      externalShowSnackbar(i18n.t('lobbies.events.kicked', 'You have been kicked from the lobby.'))
      dispatch({
        type: LOBBY_UPDATE_KICK_SELF,
      } as any)
    } else {
      dispatch({
        type: LOBBY_UPDATE_KICK,
        payload: event,
      } as any)
    }
  },

  ban: (lobbyId, event) => (dispatch, getState) => {
    const { auth } = getState()

    const user = auth.self!.user.id
    if (user === event.player.userId) {
      // It was us who has been banned from a lobby (shame on us!)
      clearCountdownTimer()
      externalShowSnackbar(i18n.t('lobbies.events.banned', 'You have been banned from the lobby.'))
      dispatch({
        type: LOBBY_UPDATE_BAN_SELF,
      } as any)
    } else {
      dispatch({
        type: LOBBY_UPDATE_BAN,
        payload: event,
      } as any)
    }
  },

  hostChange: (lobbyId, event) =>
    ({
      type: LOBBY_UPDATE_HOST_CHANGE,
      payload: event.host,
    }) as any,

  slotChange: (lobbyId, event) =>
    ({
      type: LOBBY_UPDATE_SLOT_CHANGE,
      payload: event,
    }) as any,

  startCountdown: (lobbyId, event) => (dispatch, getState) => {
    clearCountdownTimer()
    let tick = 5
    dispatch({
      type: LOBBY_UPDATE_COUNTDOWN_START,
      payload: tick,
    } as any)
    countdownState.sound = audioManager.playFadeableSound(AvailableSound.Countdown)

    countdownState.timer = setInterval(() => {
      tick -= 1
      dispatch({
        type: LOBBY_UPDATE_COUNTDOWN_TICK,
        payload: tick,
      } as any)
      if (!tick) {
        clearCountdownTimer()
        dispatch({ type: LOBBY_UPDATE_LOADING_START } as any)

        dispatch(openDialog({ type: DialogType.LaunchingGame }))
      }
    }, 1000)
  },

  cancelCountdown: (lobbyId, event) => {
    clearCountdownTimer()
    return {
      type: LOBBY_UPDATE_COUNTDOWN_CANCELED,
    } as any
  },

  cancelLoading: (lobbyId, event) => (dispatch, getState) => {
    // NOTE(tec27): In very low latency environments things can interleave such that the server
    // cancels loading before our client actually finishes the countdown/gets into the loading
    // state. Clearing the countdown timer here ensures that our client doesn't try to take us to
    // the loading screen anyway, even after it's been canceled.
    clearCountdownTimer()

    dispatch({
      type: LOBBY_UPDATE_LOADING_CANCELED,
      payload: { usersAtFault: event.usersAtFault },
    } as any)
    dispatch(closeDialog(DialogType.LaunchingGame))
  },

  gameStarted: (lobbyId, event) => (dispatch, getState) => {
    const { lobby } = getState()

    dispatch(closeDialog(DialogType.LaunchingGame))
    const currentPath = location.pathname
    const lobbyPath = urlPath`/lobbies/${lobby.info.id}`
    if (currentPath === lobbyPath || currentPath.startsWith(lobbyPath + '/')) {
      replace(urlPath`/`)
    }
    dispatch({
      type: LOBBY_UPDATE_GAME_STARTED,
      payload: {
        lobby,
      },
    } as any)
  },

  chat(lobbyId, event) {
    return (dispatch, getState) => {
      const {
        auth,
        lobby,
        relationships: { blocks },
      } = getState()

      const isBlocked = blocks.has(event.message.from)
      if (!isBlocked) {
        // Notify the main process of the new message, so it can display an appropriate notification
        ipcRenderer.send('chatNewMessage', {
          urgent: event.mentions.some(m => m.id === auth.self!.user.id),
        })
      }

      dispatch({
        type: LOBBY_UPDATE_CHAT_MESSAGE,
        payload: event,
      } as any)

      if (!isBlocked && (!lobby.activated || !windowFocus.isFocused())) {
        audioManager.playSound(AvailableSound.MessageAlert)
      }
    }
  },

  status: (lobbyId, event) =>
    ({
      type: LOBBY_UPDATE_STATUS,
      payload: event,
    }) as any,
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  const lobbyHandler: RouteHandler = (route, event) => {
    const handler = eventToAction[event.type as LobbyEvent['type']]
    if (!handler) return

    const action = handler(route.params.lobbyId as SbLobbyId, event)
    if (action) dispatch(action)
  }
  siteSocket.registerRoute('/lobbies/:lobbyId', lobbyHandler)
  siteSocket.registerRoute('/lobbies/:lobbyId/:userId', lobbyHandler)
  siteSocket.registerRoute('/lobbies/:lobbyId/:userId/:clientId', lobbyHandler)

  siteSocket.registerRoute('/lobbies', (route, event) => {
    const { action, payload } = event
    dispatch({
      type: LOBBIES_LIST_UPDATE,
      payload: {
        message: action,
        data: payload,
      },
    } as any)
  })

  siteSocket.registerRoute('/lobbiesCount', (route, event) => {
    const { count } = event
    dispatch({
      type: LOBBIES_COUNT_UPDATE,
      payload: {
        count,
      },
    } as any)
  })
}
