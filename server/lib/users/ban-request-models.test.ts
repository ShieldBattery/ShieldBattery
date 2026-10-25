import { describe, expect, test, vi } from 'vitest'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import { BanRequestConflict, lockBanRequest } from './ban-request-models'

const REQUEST = {
  requestId: '11111111-2222-4333-8444-555555555555',
  targetId: makeSbUserId(7),
  endTime: new Date('9001-01-01T00:00:00.000Z'),
  reason: 'Account policy violation',
}
const GAME_ID = '11111111-2222-4333-8444-666666666666'

function receiptClient(gameId: string | null): DbClient {
  return {
    query: vi.fn().mockResolvedValue({
      rows: [
        {
          /* eslint-disable eslint-core/camelcase */
          request_id: REQUEST.requestId,
          target_id: REQUEST.targetId,
          end_time: REQUEST.endTime,
          reason: REQUEST.reason,
          game_id: gameId,
          ban_id: 'ban-id',
          ban_ids: ['ban-id'],
          completed_at: new Date(),
          /* eslint-enable eslint-core/camelcase */
        },
      ],
    }),
  } as unknown as DbClient
}

describe('ban request identity', () => {
  test('historical requests without an association accept omitted or null game IDs', async () => {
    expect(await lockBanRequest(REQUEST, receiptClient(null))).toMatchObject({ gameId: null })
    expect(await lockBanRequest({ ...REQUEST, gameId: null }, receiptClient(null))).toMatchObject({
      gameId: null,
    })
  })

  test('retries retain the original game association', async () => {
    expect(
      await lockBanRequest({ ...REQUEST, gameId: GAME_ID }, receiptClient(GAME_ID)),
    ).toMatchObject({
      gameId: GAME_ID,
      banId: 'ban-id',
    })
  })

  test.each([
    [null, GAME_ID],
    [GAME_ID, null],
    [GAME_ID, undefined],
    [GAME_ID, '11111111-2222-4333-8444-777777777777'],
  ])('rejects changing the game association from %s to %s', async (stored, requested) => {
    await expect(
      lockBanRequest({ ...REQUEST, gameId: requested }, receiptClient(stored)),
    ).rejects.toBeInstanceOf(BanRequestConflict)
  })
})
