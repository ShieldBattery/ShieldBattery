import type { Player, ReplayHeader, ShieldBatteryData } from '@shieldbattery/broodrep'

export interface ReplayWorkerReady {
  type: 'ready'
}

export interface ParseReplayRequest {
  type: 'parse'
  path: string
}

export type ParseReplayResult = {
  type: 'parseComplete'
  path: string
} & ({ replay: ParsedReplay } | { error: Error })

export interface ParsedReplay {
  parserVersion: number
  header: ReplayHeader
  shieldBatteryData?: ShieldBatteryData
  slots: Player[]
  players: Player[]
  observers: Player[]
}

export type FromWorkerMessage = ParseReplayResult | ReplayWorkerReady
