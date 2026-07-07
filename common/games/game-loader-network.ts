import { GameSetup } from './game-launch-config'
import { NetcodeV2ServerSetup } from './netcode-v2'

export type GameLoaderEvent =
  | CancelLoading
  | SetGameConfigEvent
  | SetNetcodeV2SetupEvent
  | StartWhenReadyEvent

export interface CancelLoading {
  type: 'cancelLoading'
  gameId: string
}

export interface SetGameConfigEvent {
  type: 'setGameConfig'
  gameId: string
  setup: GameSetup
}

/**
 * Delivers a player's netcode v2 (rally-point2) session handoff: their session token, relay
 * endpoints, and the slot roster. Only sent for games using netcode v2 (see
 * `GameSetup.useNetcodeV2`), after every player has submitted their per-session public key.
 * Always published before `startWhenReady`.
 */
export interface SetNetcodeV2SetupEvent {
  type: 'setNetcodeV2Setup'
  gameId: string
  setup: NetcodeV2ServerSetup
}

export interface StartWhenReadyEvent {
  type: 'startWhenReady'
  gameId: string
}
