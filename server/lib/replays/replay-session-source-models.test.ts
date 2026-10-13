import { describe, expect, test, vi } from 'vitest'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import { SqlTemplate } from '../db/sql'
import { getReplaySessionUploadForOwner } from './replay-session-source-models'

describe('getReplaySessionUploadForOwner', () => {
  test('filters the source by its owner and requires that it has not expired', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const client = { query } as unknown as DbClient
    const now = new Date('2026-10-13T12:00:00.000Z')

    await expect(
      getReplaySessionUploadForOwner('source-id', makeSbUserId(7), now, client),
    ).resolves.toBeUndefined()

    const statement = query.mock.calls[0][0] as SqlTemplate
    expect(statement.text).toContain('owner_user_id = $2')
    expect(statement.text).toContain('expires_at > $3')
    expect(statement.values).toEqual(['source-id', makeSbUserId(7), now])
  })
})
