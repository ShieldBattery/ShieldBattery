import { GameSetup } from './game-launch-config'
import { NetcodeV2ServerSetup } from './netcode-v2'

export type GameLoaderEvent =
  CancelLoading | SetGameConfigEvent | SetNetcodeV2SetupEvent | SetLoadingStatusEvent

export interface CancelLoading {
  type: 'cancelLoading'
  gameId: string
}

/**
 * Intermediate states a load can report to players while it waits on a slower-than-usual step.
 * `provisioningGameServer` means the game server for one or more regions is still being brought up.
 */
export type GameLoadingStatus = 'provisioningGameServer'

/**
 * Reports an intermediate loading state to a player so the loading UI can explain a longer wait.
 * Deliberately carries no detail about *which* game servers are involved: server locations hint at
 * where the other players are, and revealing that before a game starts invites players to prejudge
 * the match (or dodge it), so pre-game messaging stays generic.
 */
export interface SetLoadingStatusEvent {
  type: 'setLoadingStatus'
  gameId: string
  status: GameLoadingStatus
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
 */
export interface SetNetcodeV2SetupEvent {
  type: 'setNetcodeV2Setup'
  gameId: string
  setup: NetcodeV2ServerSetup
}
