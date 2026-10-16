import { describe, expect, test, vi } from 'vitest'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import { SqlTemplate } from '../db/sql'
import {
  retainReplaySessionUploadForOwner,
  retainReplaySessionUploads,
} from './replay-session-source-models'

const NOW = new Date('2026-10-13T12:00:00.000Z')
const LATER = new Date('2026-10-14T12:00:00.000Z')

describe('retainReplaySessionUploadForOwner', () => {
  test('filters the source by its owner and requires that it has not expired', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const client = { query } as unknown as DbClient

    await expect(
      retainReplaySessionUploadForOwner('source-id', makeSbUserId(7), NOW, LATER, client),
    ).resolves.toBeUndefined()

    const statement = query.mock.calls[0][0] as SqlTemplate
    expect(statement.text).toContain('GREATEST(expires_at, $1)')
    expect(statement.text).toContain('owner_user_id = $3')
    expect(statement.text).toContain('expires_at > $4')
    expect(statement.values).toEqual([LATER, 'source-id', makeSbUserId(7), NOW])
  })
})

describe('retainReplaySessionUploads', () => {
  test('only extends sources that have not expired', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'a' }] })
    const client = { query } as unknown as DbClient

    await expect(retainReplaySessionUploads(['a', 'b'], NOW, LATER, client)).resolves.toEqual(['a'])

    const statement = query.mock.calls[0][0] as SqlTemplate
    expect(statement.text).toContain('id = ANY($2)')
    expect(statement.text).toContain('expires_at > $3')
    expect(statement.values).toEqual([LATER, ['a', 'b'], NOW])
  })

  test('skips the query when there is nothing to retain', async () => {
    const query = vi.fn()
    const client = { query } as unknown as DbClient

    await expect(retainReplaySessionUploads([], NOW, LATER, client)).resolves.toEqual([])
    expect(query).not.toHaveBeenCalled()
  })
})
