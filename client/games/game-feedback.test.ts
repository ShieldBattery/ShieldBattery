import { describe, expect, test } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { getCommendAvailability } from './game-feedback'

const PLAYER = makeSbUserId(2)
const OTHER = makeSbUserId(3)
const NOW = Date.UTC(2026, 8, 26, 12, 0, 0)
const HOUR = 60 * 60 * 1000

describe('getCommendAvailability', () => {
  test('is available with commends left and no recent commend', () => {
    expect(
      getCommendAvailability(PLAYER, {
        now: NOW,
        recentUntil: new Map(),
        commendsRemaining: 3,
        limitUntil: undefined,
      }),
    ).toEqual({ kind: 'available' })
  })

  test('is blocked while the player is on cooldown', () => {
    expect(
      getCommendAvailability(PLAYER, {
        now: NOW,
        recentUntil: new Map([[PLAYER, NOW + 2 * HOUR]]),
        commendsRemaining: 3,
        limitUntil: undefined,
      }),
    ).toEqual({ kind: 'blocked', reason: 'recent', until: new Date(NOW + 2 * HOUR) })
  })

  test("ignores other players' cooldowns and expired ones", () => {
    expect(
      getCommendAvailability(PLAYER, {
        now: NOW,
        recentUntil: new Map([
          [OTHER, NOW + 2 * HOUR],
          [PLAYER, NOW - 1],
        ]),
        commendsRemaining: 3,
        limitUntil: undefined,
      }),
    ).toEqual({ kind: 'available' })
  })

  test('is blocked at the daily limit', () => {
    expect(
      getCommendAvailability(PLAYER, {
        now: NOW,
        recentUntil: new Map(),
        commendsRemaining: 0,
        limitUntil: NOW + 5 * HOUR,
      }),
    ).toEqual({ kind: 'blocked', reason: 'limit', until: new Date(NOW + 5 * HOUR) })
  })

  test('names the limit that lifts later when both apply', () => {
    const recentLater = getCommendAvailability(PLAYER, {
      now: NOW,
      recentUntil: new Map([[PLAYER, NOW + 8 * HOUR]]),
      commendsRemaining: 0,
      limitUntil: NOW + 5 * HOUR,
    })
    expect(recentLater).toEqual({
      kind: 'blocked',
      reason: 'recent',
      until: new Date(NOW + 8 * HOUR),
    })

    const limitLater = getCommendAvailability(PLAYER, {
      now: NOW,
      recentUntil: new Map([[PLAYER, NOW + 2 * HOUR]]),
      commendsRemaining: 0,
      limitUntil: NOW + 5 * HOUR,
    })
    expect(limitLater).toEqual({
      kind: 'blocked',
      reason: 'limit',
      until: new Date(NOW + 5 * HOUR),
    })
  })

  test('is blocked by the limit even before its end time is known', () => {
    // Right after an optimistic commend uses the last one, before the server reports when the
    // next frees up
    expect(
      getCommendAvailability(PLAYER, {
        now: NOW,
        recentUntil: new Map(),
        commendsRemaining: 0,
        limitUntil: undefined,
      }),
    ).toEqual({ kind: 'blocked', reason: 'limit', until: undefined })
  })
})
