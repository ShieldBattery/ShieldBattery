import { BasicChannelInfo } from '../chat'
import { GameType } from '../games/game-type'
import { MapExtension, MapInfoJson } from '../maps'
import { BwTurnRate, BwUserLatency } from '../network'
import { SbUser } from '../users/sb-user'
import { SbUserId } from '../users/sb-user-id'
import { SlotJson } from './slot'

export type LobbyEvent =
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
  | LobbyStartWhenReadyEvent
  | LobbyCancelLoadingEvent
  | LobbyGameStartedEvent
  | LobbyChatEvent
  | LobbyStatusEvent

export interface LobbyUser {
  id: SbUserId
  name: string
}

export interface LobbySummaryJson {
  name: string
  // TODO(tec27): Actually type this
  map: MapInfoJson
  gameType: GameType
  gameSubType: number
  host: LobbyUser
  openSlotCount: number
}

export interface LobbyInitEvent {
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

export interface LobbyDiffEvent {
  type: 'diff'
  diffEvents: LobbyEvent[]
}

export interface LobbySlotCreateEvent {
  type: 'slotCreate'
  teamIndex: number
  slotIndex: number
  slot: SlotJson
  /** In case a human slot was created, this field will contain their properties, e.g. name. */
  userInfo?: LobbyUser
}

export interface LobbyRaceChangeEvent {
  type: 'raceChange'
}

export interface LobbyLeaveEvent {
  type: 'leave'
  player: SlotJson
}

export interface LobbyKickEvent {
  type: 'kick'
  player: SlotJson
}

export interface LobbyBanEvent {
  type: 'ban'
  player: SlotJson
}

export interface LobbyHostChangeEvent {
  type: 'hostChange'
  host: any
}

export interface LobbySlotChangeEvent {
  type: 'slotChange'
}

export interface LobbySlotDeletedEvent {
  type: 'slotDeleted'
}

export interface LobbyStartCountdownEvent {
  type: 'startCountdown'
}

export interface LobbyCancelCountdownEvent {
  type: 'cancelCountdown'
}

export interface LobbySetupGameEvent {
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

export interface LobbyStartWhenReadyEvent {
  type: 'startWhenReady'
  gameId: string
}

export interface LobbyCancelLoadingEvent {
  type: 'cancelLoading'
}

export interface LobbyGameStartedEvent {
  type: 'gameStarted'
}

export interface LobbyChatMessage {
  lobbyName: string
  time: number
  from: SbUserId
  text: string
}

export interface LobbyChatEvent {
  type: 'chat'
  message: LobbyChatMessage
  mentions: SbUser[]
  channelMentions: BasicChannelInfo[]
}

export interface LobbyStatusEvent {
  type: 'status'
}
