import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NetcodeV2DepartureNotification } from '../../../common/games/netcode-v2'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { recordUserDeparture } from '../models/games-users'
import {
  checkDepartureWebhookAuth,
  recordDepartureNotification,
} from './netcode-v2-departure-service'

vi.mock('../models/games-users', () => ({
  recordUserDeparture: vi.fn(),
}))

const NOTIFY_SECRET = 'the-notify-secret'
const GAME_ID = '11111111-2222-4333-8444-555555555555'

function makeNotification(
  overrides: Partial<NetcodeV2DepartureNotification> = {},
): NetcodeV2DepartureNotification {
  return {
    tenant: 'sb-dev',
    session: 1,
    externalId: GAME_ID,
    slot: 0,
    externalRef: '42',
    kind: 'left',
    reason: 3,
    leaveSeq: 1,
    ...overrides,
  }
}

describe('netcode-v2/checkDepartureWebhookAuth', () => {
  const originalSecret = process.env.SB_RP2_NOTIFY_SECRET

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.SB_RP2_NOTIFY_SECRET
    } else {
      process.env.SB_RP2_NOTIFY_SECRET = originalSecret
    }
  })

  test('returns 404 when no secret is configured, regardless of the header', () => {
    delete process.env.SB_RP2_NOTIFY_SECRET

    expect(checkDepartureWebhookAuth(`Bearer ${NOTIFY_SECRET}`)).toBe(404)
    expect(checkDepartureWebhookAuth(undefined)).toBe(404)
  })

  test('returns 401 when the bearer secret is wrong', () => {
    process.env.SB_RP2_NOTIFY_SECRET = NOTIFY_SECRET

    expect(checkDepartureWebhookAuth('Bearer not-the-secret')).toBe(401)
  })

  test('returns 401 when the Authorization header is missing entirely', () => {
    process.env.SB_RP2_NOTIFY_SECRET = NOTIFY_SECRET

    expect(checkDepartureWebhookAuth(undefined)).toBe(401)
  })

  test('returns null when the bearer secret matches', () => {
    process.env.SB_RP2_NOTIFY_SECRET = NOTIFY_SECRET

    expect(checkDepartureWebhookAuth(`Bearer ${NOTIFY_SECRET}`)).toBeNull()
  })
})

describe('netcode-v2/recordDepartureNotification', () => {
  beforeEach(() => {
    asMockedFunction(recordUserDeparture).mockReset()
  })

  test('records the departure when it is genuine', async () => {
    asMockedFunction(recordUserDeparture).mockResolvedValue(true)

    await recordDepartureNotification(makeNotification({ kind: 'dropped' }))

    expect(recordUserDeparture).toHaveBeenCalledWith({
      userId: makeSbUserId(42),
      gameId: GAME_ID,
      kind: 'dropped',
      time: expect.any(Date),
    })
  })

  test('completes without error when the departure is moot (terminal result already held)', async () => {
    asMockedFunction(recordUserDeparture).mockResolvedValue(false)

    await expect(recordDepartureNotification(makeNotification())).resolves.toBeUndefined()

    expect(recordUserDeparture).toHaveBeenCalledTimes(1)
  })

  test('does not call the model when externalRef is not an integer', async () => {
    await recordDepartureNotification(makeNotification({ externalRef: 'not-a-number' }))

    expect(recordUserDeparture).not.toHaveBeenCalled()
  })

  test('does not call the model when externalRef is missing', async () => {
    await recordDepartureNotification(makeNotification({ externalRef: undefined }))

    expect(recordUserDeparture).not.toHaveBeenCalled()
  })

  test('does not call the model when externalId is not a valid gameId', async () => {
    await recordDepartureNotification(makeNotification({ externalId: 'not-a-uuid' }))

    expect(recordUserDeparture).not.toHaveBeenCalled()
  })

  test('does not call the model when externalId is missing', async () => {
    await recordDepartureNotification(makeNotification({ externalId: undefined }))

    expect(recordUserDeparture).not.toHaveBeenCalled()
  })
})
