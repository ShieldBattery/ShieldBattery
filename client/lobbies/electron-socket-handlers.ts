import { NydusClient, RouteHandler } from 'nydus-client'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { BasicChannelInfo } from '../../common/chat'
import { GameLaunchConfig, GameRoute, PlayerInfo } from '../../common/game-launch-config'
import { TypedIpcRenderer } from '../../common/ipc'
import { getIngameLobbySlotsWithIndexes } from '../../common/lobbies'
import { MapExtension, MapInfoJson } from '../../common/maps'
import { BwTurnRate, BwUserLatency } from '../../common/network'
import { urlPath } from '../../common/urls'
import { SbUser } from '../../common/users/sb-user'
import { SbUserId } from '../../common/users/sb-user-id'
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
  LOBBY_UPDATE_SLOT_DELETED,
  LOBBY_UPDATE_STATUS,
} from '../actions'
import audioManager, { AudioManager, AvailableSound } from '../audio/audio-manager'
import { Dispatchable, dispatch } from '../dispatch-registry'
import windowFocus from '../dom/window-focus'
import i18n from '../i18n/i18next'
import { replace } from '../navigation/routing'
import { makeServerUrl } from '../network/server-url'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'

const ipcRenderer = new TypedIpcRenderer()

interface CountdownState {
  timer: ReturnType<typeof setInterval> | undefined
  sound: ReturnType<AudioManager['playFadeableSound']> | undefined
  atmosphere: ReturnType<AudioManager['playFadeableSound']> | undefined
}

const countdownState: CountdownState = {
  timer: undefined,
  sound: undefined,
  atmosphere: undefined,
}
function fadeAtmosphere(fast = true) {
  const { atmosphere } = countdownState
  if (atmosphere) {
    const timing = fast ? 1.5 : 3
    atmosphere.gainNode.gain.exponentialRampToValueAtTime(0.001, audioManager.currentTime + timing)
    atmosphere.source.stop(audioManager.currentTime + timing + 0.1)
    countdownState.atmosphere = undefined
  }
}
function clearCountdownTimer(leaveAtmosphere = false) {
  const { timer, sound, atmosphere } = countdownState
  if (timer) {
    clearInterval(timer)
    countdownState.timer = undefined
  }
  if (sound) {
    sound.gainNode.gain.exponentialRampToValueAtTime(0.001, audioManager.currentTime + 0.5)
    sound.source.stop(audioManager.currentTime + 0.6)
    countdownState.sound = undefined
  }
  if (!leaveAtmosphere && atmosphere) {
    fadeAtmosphere()
  }
}

type LobbyEvent =
  | LobbyInitEvent
  | LobbyDiffEvent
  | LobbySlotCreateEvent
  | LobbyRaceChangeEvent
  | LobbyLeaveEvent
  | LobbyKickEvent
  | LobbyBanEvent
  | LobbyHostChangeEvent
  | LobbySlotChangeEvent
  | LobbySlotDeletedEvent
  | LobbyStartCountdownEvent
  | LobbyCancelCountdownEvent
  | LobbySetupGameEvent
  | LobbySetRoutesEvent
  | LobbyStartWhenReadyEvent
  | LobbyCancelLoadingEvent
  | LobbyGameStartedEvent
  | LobbyChatEvent
  | LobbyStatusEvent

interface LobbyUser {
  id: SbUserId
  name: string
}

interface LobbyInitEvent {
  type: 'init'
  // TODO(tec27): actually type this
  lobby: {
    map: {
      hash: string
      mapData: {
        format: MapExtension
      }
      mapUrl: string
    }
  }
  /** An array of infos for all users that were in the lobby at this point. */
  userInfos: LobbyUser[]
}

interface LobbyDiffEvent {
  type: 'diff'
  diffEvents: LobbyEvent[]
}

interface LobbySlotCreateEvent {
  type: 'slotCreate'
  // TODO(tec27): actually type this
  slot: {
    type: 'human' | 'computer'
  }
  /** In case a human slot was created, this field will contain their properties, e.g. name. */
  userInfo?: LobbyUser
}

interface LobbyRaceChangeEvent {
  type: 'raceChange'
}

interface LobbyLeaveEvent {
  type: 'leave'
  player: {
    name: string
  }
}

interface LobbyKickEvent {
  type: 'kick'
  player: {
    name: string
  }
}

interface LobbyBanEvent {
  type: 'ban'
  player: {
    name: string
  }
}

interface LobbyHostChangeEvent {
  type: 'hostChange'
  host: any
}

interface LobbySlotChangeEvent {
  type: 'slotChange'
}

interface LobbySlotDeletedEvent {
  type: 'slotDeleted'
}

interface LobbyStartCountdownEvent {
  type: 'startCountdown'
}

interface LobbyCancelCountdownEvent {
  type: 'cancelCountdown'
}

interface LobbySetupGameEvent {
  type: 'setupGame'
  setup: {
    gameId: string
    seed: number
    turnRate?: BwTurnRate | 0
    userLatency?: BwUserLatency
    useLegacyLimits?: boolean
  }
  // TODO(tec27): Right now this can be undefined if the local player is an observer, but perhaps
  // that should be handled differently?
  resultCode?: string
}

interface LobbySetRoutesEvent {
  type: 'setRoutes'
  gameId: string
  routes: GameRoute[]
}

interface LobbyStartWhenReadyEvent {
  type: 'startWhenReady'
  gameId: string
}

interface LobbyCancelLoadingEvent {
  type: 'cancelLoading'
}

interface LobbyGameStartedEvent {
  type: 'gameStarted'
}

interface LobbyChatMessage {
  lobbyName: string
  time: number
  from: SbUserId
  text: string
}

interface LobbyChatEvent {
  type: 'chat'
  message: LobbyChatMessage
  mentions: SbUser[]
  channelMentions: BasicChannelInfo[]
}

interface LobbyStatusEvent {
  type: 'status'
}

type EventToActionMap = {
  [E in LobbyEvent['type']]: (
    lobbyName: string,
    event: Extract<LobbyEvent, { type: E }>,
  ) => Dispatchable | void
}

const eventToAction: EventToActionMap = {
  init: (name, event) => {
    clearCountdownTimer()
    const { hash, mapData, mapUrl } = event.lobby.map
    ipcRenderer.invoke('mapStoreDownloadMap', hash, mapData.format, mapUrl)?.catch(err => {
      // TODO(tec27): Report this to the server so the loading is canceled immediately

      // This is already logged to our file by the map store, so we just log it to the console for
      // easy visibility during development
      console.error('Error downloading map: ' + err.stack)
    })

    ipcRenderer.send('rallyPointRefreshPings')

    return {
      type: LOBBY_INIT_DATA,
      payload: event,
    } as any
  },

  diff: (name, event) => dispatch => {
    for (const diffEvent of event.diffEvents) {
      const diffAction = eventToAction[diffEvent.type]!(name, diffEvent as any)
      if (diffAction) dispatch(diffAction)
    }
  },

  slotCreate: (name, event) => {
    if (event.slot.type === 'human') {
      audioManager.playSound(AvailableSound.JoinAlert)
      ipcRenderer.send('userAttentionRequired')
    }

    return {
      type: LOBBY_UPDATE_SLOT_CREATE,
      payload: event,
    } as any
  },

  raceChange: (name, event) =>
    ({
      type: LOBBY_UPDATE_RACE_CHANGE,
      payload: event,
    }) as any,

  leave: (name, event) => (dispatch, getState) => {
    const { auth } = getState()

    const user = auth.self!.user.name
    if (user === event.player.name) {
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

  kick: (name, event) => (dispatch, getState) => {
    const { auth } = getState()

    const user = auth.self!.user.name
    if (user === event.player.name) {
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

  ban: (name, event) => (dispatch, getState) => {
    const { auth } = getState()

    const user = auth.self!.user.name
    if (user === event.player.name) {
      // It was us who have been banned from a lobby (shame on us!)
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

  hostChange: (name, event) =>
    ({
      type: LOBBY_UPDATE_HOST_CHANGE,
      payload: event.host,
    }) as any,

  slotChange: (name, event) =>
    ({
      type: LOBBY_UPDATE_SLOT_CHANGE,
      payload: event,
    }) as any,

  slotDeleted: (name, event) =>
    ({
      type: LOBBY_UPDATE_SLOT_DELETED,
      payload: event,
    }) as any,

  startCountdown: (name, event) => (dispatch, getState) => {
    clearCountdownTimer()
    let tick = 5
    dispatch({
      type: LOBBY_UPDATE_COUNTDOWN_START,
      payload: tick,
    } as any)
    countdownState.sound = audioManager.playFadeableSound(AvailableSound.Countdown)
    countdownState.atmosphere = audioManager.playFadeableSound(AvailableSound.Atmosphere)

    countdownState.timer = setInterval(() => {
      tick -= 1
      dispatch({
        type: LOBBY_UPDATE_COUNTDOWN_TICK,
        payload: tick,
      } as any)
      if (!tick) {
        clearCountdownTimer(true /* leaveAtmosphere */)
        dispatch({ type: LOBBY_UPDATE_LOADING_START } as any)

        const { lobby } = getState()

        const currentPath = location.pathname
        if (currentPath === urlPath`/lobbies/${lobby.info.name}`) {
          replace(urlPath`/lobbies/${lobby.info.name}/loading-game`)
        }
      }
    }, 1000)
  },

  cancelCountdown: (name, event) => {
    clearCountdownTimer()
    return {
      type: LOBBY_UPDATE_COUNTDOWN_CANCELED,
    } as any
  },

  setupGame: (name, event) => (dispatch, getState) => {
    const {
      lobby,
      auth: { self },
    } = getState()

    const {
      info: { name: lobbyName, map, gameType, gameSubType, host },
    } = lobby

    const playerInfos = getIngameLobbySlotsWithIndexes(lobby.info as any)
      .map<PlayerInfo>(([teamIndex, , slot]: [number, any, any]) => ({
        id: slot.id,
        name: slot.name,
        race: slot.race,
        playerId: slot.playerId,
        type: slot.type,
        typeId: slot.typeId,
        userId: slot.userId,
        teamId: lobby.info.teams.get(teamIndex).teamId,
      }))
      .toArray()
    const hostInfo = playerInfos.find(s => s.id === host.id)!

    const config: GameLaunchConfig = {
      localUser: { id: self!.user.id, name: self!.user.name },
      setup: {
        gameId: event.setup.gameId,
        name: lobbyName,
        map: map as unknown as MapInfoJson,
        gameType,
        gameSubType,
        slots: playerInfos,
        host: hostInfo,
        seed: event.setup.seed,
        turnRate: event.setup.turnRate,
        userLatency: event.setup.userLatency,
        useLegacyLimits: event.setup.useLegacyLimits,
        resultCode: event.resultCode,
        serverUrl: makeServerUrl(''),
      },
    }

    dispatch({
      type: '@active-game/launch',
      payload: ipcRenderer.invoke('activeGameSetConfig', config)!,
    })
  },

  setRoutes: (name, event) => dispatch => {
    const { routes, gameId } = event

    ipcRenderer.invoke('activeGameSetRoutes', gameId, routes)?.catch(swallowNonBuiltins)
  },

  startWhenReady: (name, event) => {
    const { gameId } = event

    ipcRenderer.invoke('activeGameStartWhenReady', gameId)?.catch(swallowNonBuiltins)
  },

  cancelLoading: (name, event) => (dispatch, getState) => {
    // NOTE(tec27): In very low latency environments things can interleave such that the server
    // cancels loading before our client actually finishes the countdown/gets into the loading
    // state. Clearing the countdown timer here ensures that our client doesn't try to take us to
    // the loading screen anyway, even after it's been canceled.
    clearCountdownTimer()
    dispatch({
      // TODO(2Pac): This should probably be a different action than the countdown canceled one? As
      // it is currently, this displays the same chat message twice in the lobby if someone leaves
      // during countdown.
      type: LOBBY_UPDATE_COUNTDOWN_CANCELED,
    } as any)

    fadeAtmosphere()

    const { lobby } = getState()
    const currentPath = location.pathname
    if (currentPath === urlPath`/lobbies/${lobby.info.name}/loading-game`) {
      replace(urlPath`/lobbies/${lobby.info.name}`)
    }

    dispatch({
      type: '@active-game/launch',
      payload: ipcRenderer.invoke('activeGameSetConfig', {})!,
    })
    dispatch({ type: LOBBY_UPDATE_LOADING_CANCELED } as any)
  },

  gameStarted: (name, event) => (dispatch, getState) => {
    fadeAtmosphere(false /* fast */)

    const { lobby } = getState()

    const currentPath = location.pathname
    if (currentPath === urlPath`/lobbies/${lobby.info.name}/loading-game`) {
      replace(urlPath`/lobbies/${lobby.info.name}/active-game`)
    }
    dispatch({
      type: LOBBY_UPDATE_GAME_STARTED,
      payload: {
        lobby,
      },
    } as any)
  },

  chat(name, event) {
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

  status: (name, event) =>
    ({
      type: LOBBY_UPDATE_STATUS,
      payload: event,
    }) as any,
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  const lobbyHandler: RouteHandler = (route, event) => {
    const handler = eventToAction[event.type as LobbyEvent['type']]
    if (!handler) return

    const action = handler(route.params.lobby, event)
    if (action) dispatch(action)
  }
  siteSocket.registerRoute('/lobbies/:lobby', lobbyHandler)
  siteSocket.registerRoute('/lobbies/:lobby/:playerName', lobbyHandler)
  siteSocket.registerRoute('/lobbies/:lobby/:userId/:clientId', lobbyHandler)

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
