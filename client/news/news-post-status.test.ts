import { describe, expect, test } from 'vitest'
import { getPostStatus } from './news-post-status'

describe('getPostStatus', () => {
  test('returns draft for a null publishedAt', () => {
    expect(getPostStatus(null, Date.now())).toEqual({ kind: 'draft' })
  })

  test('returns draft for an undefined publishedAt', () => {
    expect(getPostStatus(undefined, Date.now())).toEqual({ kind: 'draft' })
  })

  test('returns scheduled for a publishedAt in the future', () => {
    const now = Date.UTC(2026, 0, 1)
    const publishedAt = new Date(now + 60_000).toISOString()

    expect(getPostStatus(publishedAt, now)).toEqual({
      kind: 'scheduled',
      date: new Date(publishedAt),
    })
  })

  test('returns published for a publishedAt in the past', () => {
    const now = Date.UTC(2026, 0, 1)
    const publishedAt = new Date(now - 60_000).toISOString()

    expect(getPostStatus(publishedAt, now)).toEqual({
      kind: 'published',
      date: new Date(publishedAt),
    })
  })

  test('returns published for a publishedAt exactly equal to now', () => {
    const now = Date.UTC(2026, 0, 1)
    const publishedAt = new Date(now).toISOString()

    expect(getPostStatus(publishedAt, now)).toEqual({
      kind: 'published',
      date: new Date(publishedAt),
    })
  })
})
