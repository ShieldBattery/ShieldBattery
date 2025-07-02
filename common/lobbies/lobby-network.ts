import { BasicChannelInfo } from '../chat'
import { GameType } from '../games/game-type'
import { MapInfoJson } from '../maps'
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
  | LobbyCancelLoadingEvent
  | LobbyGameStartedEvent
  | LobbyChatEvent
  | LobbyStatusEvent

export interface LobbySummaryJson {
  name: string
  map: MapInfoJson
  gameType: GameType
  gameSubType: number
  host: { id: SbUserId }
  openSlotCount: number
}

export interface LobbyInitEvent {
  type: 'init'
  // TODO(tec27): actually type this
  lobby: {
    map: MapInfoJson
  }
  /** An array of infos for all users that were in the lobby at this point. */
  userInfos: SbUser[]
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
