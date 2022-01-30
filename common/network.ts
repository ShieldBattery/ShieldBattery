import { assertUnreachable } from './assert-unreachable'

/** User-controllable ingame latency settings. */
export enum BwUserLatency {
  Low,
  High,
  ExtraHigh,
}

export function userLatencyToTurnBuffer(latency: BwUserLatency): number {
  switch (latency) {
    case BwUserLatency.Low:
      return 2
    case BwUserLatency.High:
      return 3
    case BwUserLatency.ExtraHigh:
      return 4
    default:
      return assertUnreachable(latency)
  }
}

// NOTE(tec27): This is a conservative estimate for how much any given turn execution can be
// delayed/early, as well as overhead from sending/receiving packets. This is based on experiments
// done by me locally. I can guarantee that meeting the latency given without this value will not
// provide lag-free gameplay, but the overhead appears to be a constant factor rather than a factor
// of the turn rate or user latency setting.
const NETWORK_OVERHEAD_MS = 20

/**
 * Returns the amount of time between a turn starting and it playing back ingame, given a
 * particular turn rate and user latency setting.
 *
 * Note this does *not* match the formula/values previously given by Blizzard for this, as those
 * values were incorrect and based on a faulty assumption of how time works (lol).
 */
export function turnRateToMaxLatency(
  turnRate: BwTurnRate,
  userLatency: BwUserLatency = BwUserLatency.Low,
): number {
  if (turnRate > 24 || turnRate < 8) {
    throw new Error('turnRate must be between 8 and 24')
  }

  return (1000 * userLatencyToTurnBuffer(userLatency)) / turnRate - NETWORK_OVERHEAD_MS
}

export type BwTurnRate = 8 | 10 | 12 | 14 | 16 | 20 | 24

export const ALL_TURN_RATES: ReadonlyArray<BwTurnRate> = [8, 10, 12, 14, 16, 20, 24]
export const TURN_RATE_DYNAMIC = 0
