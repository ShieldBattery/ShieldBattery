import { NydusClient, RouteHandler } from 'nydus-client'
import { TypedIpcRenderer } from '../../common/ipc'
import { LobbyEvent } from '../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { urlPath } from '../../common/urls'
import { audioManager, AvailableSound, FadeableSound } from '../audio/audio-manager'
import { closeDialog, openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { dispatch, Dispatchable } from '../dispatch-registry'
import windowFocus from '../dom/window-focus'
import i18n from '../i18n/i18next'
import { replace } from '../navigation/routing'
import { RootState } from '../root-reducer'
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

/**
 * Returns whether the current user is waiting on the lobby's bench rather than holding a slot.
 *
 * Callers include timer callbacks that can outlive the lobby (or the session), so a missing self
 * user reads as "not benched" rather than throwing.
 */
function selfIsBenched(state: RootState): boolean {
  const { auth, lobby } = state
  const selfId = auth.self?.user.id
  return selfId !== undefined && lobby.info.bench.some(benched => benched.userId === selfId)
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
    const { hash, mapData, mapUrl } = event.lobby.map!
    ipcRenderer.invoke('mapStoreDownloadMap', hash, mapData.format, mapUrl!)?.catch(err => {
      // TODO(tec27): Report this to the server so the loading is canceled immediately

      // This is already logged to our file by the map store, so we just log it to the console for
      // easy visibility during development
      console.error('Error downloading map: ' + err.stack)
    })

    return {
      type: '@lobbies/init',
      payload: event,
    }
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
      type: '@lobbies/updateSlotCreate',
      payload: event,
    }
  },

  raceChange: (lobbyId, event) => ({
    type: '@lobbies/updateRaceChange',
    payload: event,
  }),

  leave: (lobbyId, event) => (dispatch, getState) => {
    const { auth } = getState()

    const user = auth.self!.user.id
    if (user === event.player.userId) {
      // The leaver was me all along!!!
      clearCountdownTimer()
      dispatch({
        type: '@lobbies/updateLeaveSelf',
      })
    } else {
      dispatch({
        type: '@lobbies/updateLeave',
        payload: event,
      })
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
        type: '@lobbies/updateKickSelf',
      })
    } else {
      dispatch({
        type: '@lobbies/updateKick',
        payload: event,
      })
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
        type: '@lobbies/updateBanSelf',
      })
    } else {
      dispatch({
        type: '@lobbies/updateBan',
        payload: event,
      })
    }
  },

  hostChange: (lobbyId, event) => ({
    type: '@lobbies/updateHostChange',
    payload: event.host,
  }),

  slotChange: (lobbyId, event) => ({
    type: '@lobbies/updateSlotChange',
    payload: event,
  }),

  // The countdown belongs to the lobby, not to any one member's game: everyone in the lobby,
  // benched or seated, follows it (and sees it) the same way. Only the local game launch it leads
  // into is specific to the members holding a slot.
  startCountdown: (lobbyId, event) => (dispatch, getState) => {
    clearCountdownTimer()
    let tick = 5
    dispatch({
      type: '@lobbies/updateCountdownStart',
      payload: tick,
    })
    countdownState.sound = audioManager.playFadeableSound(AvailableSound.Countdown)

    countdownState.timer = setInterval(() => {
      tick -= 1
      dispatch({
        type: '@lobbies/updateCountdownTick',
        payload: tick,
      })
      if (!tick) {
        clearCountdownTimer()
        dispatch({ type: '@lobbies/updateLoadingStart' })

        // A benched member holds no slot in the game being loaded, so nothing launches locally for
        // them and this dialog would have nothing to resolve it: they stay on the lobby instead.
        if (!selfIsBenched(getState())) {
          dispatch(openDialog({ type: DialogType.LaunchingGame }))
        }
      }
    }, 1000)
  },

  cancelCountdown: (lobbyId, event) => dispatch => {
    clearCountdownTimer()
    dispatch({
      type: '@lobbies/updateCountdownCanceled',
    })
  },

  cancelLoading: (lobbyId, event) => dispatch => {
    // NOTE(tec27): In very low latency environments things can interleave such that the server
    // cancels loading before our client actually finishes the countdown/gets into the loading
    // state. Clearing the countdown timer here ensures that our client doesn't try to take us to
    // the loading screen anyway, even after it's been canceled.
    clearCountdownTimer()

    dispatch({
      type: '@lobbies/updateLoadingCanceled',
      payload: { usersAtFault: event.usersAtFault },
    })
    dispatch(closeDialog(DialogType.LaunchingGame))
  },

  gameStarted: (lobbyId, event) => (dispatch, getState) => {
    const state = getState()
    const { lobby } = state

    // The lobby's game is under way, so a countdown still running locally (one that trailed the
    // server's) has nothing left to run out to.
    clearCountdownTimer()
    dispatch(closeDialog(DialogType.LaunchingGame))
    const currentPath = location.pathname
    const lobbyPath = urlPath`/lobbies/${lobby.info.id}`
    if (currentPath === lobbyPath || currentPath.startsWith(lobbyPath + '/')) {
      replace(urlPath`/`)
    }
    if (selfIsBenched(state)) {
      // The lobby is over for a benched member too, but no game of theirs has started: marking one
      // active would stick, since only their own game's lifecycle ever clears that state again
      dispatch({
        type: '@lobbies/updateLeaveSelf',
      })
    } else {
      dispatch({
        type: '@lobbies/updateGameStarted',
      })
    }
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
        type: '@lobbies/updateChatMessage',
        payload: event,
      })

      if (!isBlocked && (!lobby.activated || !windowFocus.isFocused())) {
        audioManager.playSound(AvailableSound.MessageAlert)
      }
    }
  },

  memberGameEnded: () => undefined,

  regroup: () => undefined,

  settingsChange: (lobbyId, event) => {
    if (event.changedSettings.includes('map')) {
      // Start downloading the new map right away (like joining does), so that game loading isn't
      // left to fetch it from scratch once the countdown completes
      const { hash, mapData, mapUrl } = event.lobby.map!
      ipcRenderer.invoke('mapStoreDownloadMap', hash, mapData.format, mapUrl!)?.catch(err => {
        // This is already logged to our file by the map store, so we just log it to the console for
        // easy visibility during development
        console.error('Error downloading map: ' + err.stack)
      })
    }

    return {
      type: '@lobbies/updateSettingsChange',
      payload: event,
    }
  },

  benchAdd: (lobbyId, event) => ({
    type: '@lobbies/updateBenchAdd',
    payload: event,
  }),

  benchRemove: (lobbyId, event) => (dispatch, getState) => {
    const { auth } = getState()

    if (auth.self!.user.id !== event.userId) {
      dispatch({
        type: '@lobbies/updateBenchRemove',
        payload: event,
      })
      return
    }

    // A bench member holds no slot, so no leave/kick/ban event follows this one: if the removed
    // member is us and we weren't seated (an absent reason), this event is how we find out we're
    // out of the lobby.
    switch (event.reason) {
      case undefined:
        dispatch({
          type: '@lobbies/updateBenchRemove',
          payload: event,
        })
        break
      case 'left':
        clearCountdownTimer()
        dispatch({
          type: '@lobbies/updateLeaveSelf',
        })
        break
      case 'kicked':
        clearCountdownTimer()
        externalShowSnackbar(
          i18n.t('lobbies.events.kicked', 'You have been kicked from the lobby.'),
        )
        dispatch({
          type: '@lobbies/updateKickSelf',
        })
        break
      case 'banned':
        clearCountdownTimer()
        externalShowSnackbar(
          i18n.t('lobbies.events.banned', 'You have been banned from the lobby.'),
        )
        dispatch({
          type: '@lobbies/updateBanSelf',
        })
        break
      default:
        event.reason satisfies never
    }
  },

  // Nothing in the client's state depends on which of our own clients are in the lobby.
  status: () => {},
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
      type: '@lobbies/listUpdate',
      payload: {
        message: action,
        data: payload,
      },
    })
  })

  siteSocket.registerRoute('/lobbiesCount', (route, event) => {
    const { count } = event
    dispatch({
      type: '@lobbies/countUpdate',
      payload: {
        count,
      },
    })
  })
}
