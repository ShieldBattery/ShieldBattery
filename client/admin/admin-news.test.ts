import { describe, expect, test } from 'vitest'
import {
  changedFieldLabels,
  createPublishedAt,
  getPostStatus,
  insertInlineImage,
  NewsEditorModel,
  NewsPostEdit,
  PUBLISH_MODE_DRAFT,
  PUBLISH_MODE_NOW,
  PUBLISH_MODE_SCHEDULE,
  publishedAtUpdate,
  toDateTimeLocalString,
} from './admin-news'

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

describe('toDateTimeLocalString', () => {
  test('formats a date with zero-padded components', () => {
    const date = new Date(2026, 0, 5, 9, 3)

    expect(toDateTimeLocalString(date)).toBe('2026-01-05T09:03')
  })

  test('pads single-digit month and day', () => {
    const date = new Date(2026, 8, 1, 0, 0)

    expect(toDateTimeLocalString(date)).toBe('2026-09-01T00:00')
  })

  test('does not pad four-digit years or double-digit components', () => {
    const date = new Date(2026, 11, 25, 23, 59)

    expect(toDateTimeLocalString(date)).toBe('2026-12-25T23:59')
  })
})

describe('createPublishedAt', () => {
  const baseModel: NewsEditorModel = {
    title: 'Title',
    summary: 'Summary',
    content: 'Content',
    publishMode: PUBLISH_MODE_DRAFT,
    scheduledAt: '',
  }

  test('returns undefined for draft mode', () => {
    expect(createPublishedAt({ ...baseModel, publishMode: PUBLISH_MODE_DRAFT })).toBeUndefined()
  })

  test('returns the ISO string of the scheduled date for schedule mode', () => {
    const scheduledAt = toDateTimeLocalString(new Date(2026, 5, 15, 10, 30))

    expect(
      createPublishedAt({ ...baseModel, publishMode: PUBLISH_MODE_SCHEDULE, scheduledAt }),
    ).toBe(new Date(scheduledAt).toISOString())
  })

  test('returns a parseable ISO string for publish-now mode', () => {
    const result = createPublishedAt({ ...baseModel, publishMode: PUBLISH_MODE_NOW })

    expect(result).toBeDefined()
    expect(new Date(result!).toISOString()).toBe(result)
  })
})

describe('publishedAtUpdate', () => {
  const baseModel: NewsEditorModel = {
    title: 'Title',
    summary: 'Summary',
    content: 'Content',
    publishMode: PUBLISH_MODE_DRAFT,
    scheduledAt: '',
  }

  test('draft mode with an originally unpublished post makes no change', () => {
    const model: NewsEditorModel = { ...baseModel, publishMode: PUBLISH_MODE_DRAFT }

    expect(publishedAtUpdate(model, null)).toBeUndefined()
  })

  test('draft mode with an originally published post explicitly unpublishes', () => {
    const model: NewsEditorModel = { ...baseModel, publishMode: PUBLISH_MODE_DRAFT }
    const original = new Date(2026, 0, 1).toISOString()

    expect(publishedAtUpdate(model, original)).toEqual({ value: null })
  })

  test('now mode always re-dates the post, even if already published', () => {
    const model: NewsEditorModel = { ...baseModel, publishMode: PUBLISH_MODE_NOW }
    const original = new Date(2026, 0, 1).toISOString()

    const result = publishedAtUpdate(model, original)

    expect(result).toBeDefined()
    expect(result!.value).not.toBeNull()
    expect(new Date(result!.value!).toISOString()).toBe(result!.value)
  })

  test('schedule mode makes no change when the target minute matches the original', () => {
    const scheduledAt = toDateTimeLocalString(new Date(2026, 5, 15, 10, 30))
    const original = new Date(2026, 5, 15, 10, 30, 45, 123).toISOString()
    const model: NewsEditorModel = {
      ...baseModel,
      publishMode: PUBLISH_MODE_SCHEDULE,
      scheduledAt,
    }

    expect(publishedAtUpdate(model, original)).toBeUndefined()
  })

  test('schedule mode updates when the target minute differs from the original', () => {
    const scheduledAt = toDateTimeLocalString(new Date(2026, 5, 15, 10, 30))
    const original = new Date(2026, 5, 15, 10, 31).toISOString()
    const model: NewsEditorModel = {
      ...baseModel,
      publishMode: PUBLISH_MODE_SCHEDULE,
      scheduledAt,
    }

    expect(publishedAtUpdate(model, original)).toEqual({
      value: new Date(scheduledAt).toISOString(),
    })
  })

  test('schedule mode updates when the post was originally unpublished', () => {
    const scheduledAt = toDateTimeLocalString(new Date(2026, 5, 15, 10, 30))
    const model: NewsEditorModel = {
      ...baseModel,
      publishMode: PUBLISH_MODE_SCHEDULE,
      scheduledAt,
    }

    expect(publishedAtUpdate(model, null)).toEqual({
      value: new Date(scheduledAt).toISOString(),
    })
  })
})

describe('changedFieldLabels', () => {
  const t = ((_key: string, def: string) => def) as Parameters<typeof changedFieldLabels>[2]

  const baseEdit: NewsPostEdit = {
    title: 'Title',
    summary: 'Summary',
    content: 'Content',
    publishedAt: null,
    coverImagePath: null,
    editedAt: new Date(2026, 0, 1).toISOString(),
    editor: null,
  }

  test('returns no labels for the creation entry (no older revision)', () => {
    expect(changedFieldLabels(baseEdit, undefined, t)).toEqual([])
  })

  test('returns no labels when nothing changed', () => {
    expect(changedFieldLabels({ ...baseEdit }, { ...baseEdit }, t)).toEqual([])
  })

  test('reports a changed title', () => {
    const edit = { ...baseEdit, title: 'New title' }

    expect(changedFieldLabels(edit, baseEdit, t)).toEqual(['Title'])
  })

  test('reports a changed summary', () => {
    const edit = { ...baseEdit, summary: 'New summary' }

    expect(changedFieldLabels(edit, baseEdit, t)).toEqual(['Summary'])
  })

  test('reports changed content', () => {
    const edit = { ...baseEdit, content: 'New content' }

    expect(changedFieldLabels(edit, baseEdit, t)).toEqual(['Content'])
  })

  test('reports a changed publish date', () => {
    const older = { ...baseEdit, publishedAt: new Date(2026, 0, 1).toISOString() }
    const edit = { ...baseEdit, publishedAt: new Date(2026, 0, 2).toISOString() }

    expect(changedFieldLabels(edit, older, t)).toEqual(['Publish date'])
  })

  test('does not report a publish date change when both are null', () => {
    expect(
      changedFieldLabels({ ...baseEdit, publishedAt: null }, { ...baseEdit, publishedAt: null }, t),
    ).toEqual([])
  })

  test('reports a publish date change from null to a value', () => {
    const edit = { ...baseEdit, publishedAt: new Date(2026, 0, 1).toISOString() }

    expect(changedFieldLabels(edit, baseEdit, t)).toEqual(['Publish date'])
  })

  test('reports a changed cover image', () => {
    const older = { ...baseEdit, coverImagePath: '/covers/old.png' }
    const edit = { ...baseEdit, coverImagePath: '/covers/new.png' }

    expect(changedFieldLabels(edit, older, t)).toEqual(['Cover image'])
  })

  test('does not report a cover image change when both are null', () => {
    expect(
      changedFieldLabels(
        { ...baseEdit, coverImagePath: null },
        { ...baseEdit, coverImagePath: null },
        t,
      ),
    ).toEqual([])
  })

  test('reports a cover image change from null to a value', () => {
    const edit = { ...baseEdit, coverImagePath: '/covers/new.png' }

    expect(changedFieldLabels(edit, baseEdit, t)).toEqual(['Cover image'])
  })

  test('reports all changed fields, in field order', () => {
    const older = {
      ...baseEdit,
      publishedAt: new Date(2026, 0, 1).toISOString(),
      coverImagePath: '/covers/old.png',
    }
    const edit = {
      ...baseEdit,
      title: 'New title',
      summary: 'New summary',
      content: 'New content',
      publishedAt: new Date(2026, 0, 2).toISOString(),
      coverImagePath: '/covers/new.png',
    }

    expect(changedFieldLabels(edit, older, t)).toEqual([
      'Title',
      'Summary',
      'Content',
      'Publish date',
      'Cover image',
    ])
  })
})

describe('insertInlineImage', () => {
  test('inserts the snippet at the cursor position when the selection is empty', () => {
    const content = 'Before after'
    const cursor = 'Before'.length

    const result = insertInlineImage(content, 'https://example.com/a.png', {
      start: cursor,
      end: cursor,
    })

    expect(result.content).toBe('Before![](https://example.com/a.png) after')
    expect(result.cursor).toBe(cursor + 2)
  })

  test('replaces a non-empty selection with the snippet', () => {
    const content = 'Before SELECTED after'
    const start = content.indexOf('SELECTED')
    const end = start + 'SELECTED'.length

    const result = insertInlineImage(content, 'https://example.com/a.png', { start, end })

    expect(result.content).toBe('Before ![](https://example.com/a.png) after')
    expect(result.cursor).toBe(start + 2)
  })

  test('appends to non-empty content with a blank-line separator, trimming trailing whitespace', () => {
    const content = 'Existing paragraph.\n\n  '

    const result = insertInlineImage(content, 'https://example.com/a.png')

    expect(result.content).toBe('Existing paragraph.\n\n![](https://example.com/a.png)')
    expect(result.cursor).toBe(result.content.indexOf('![') + 2)
  })

  test('inserts into empty content without a separator', () => {
    const result = insertInlineImage('', 'https://example.com/a.png')

    expect(result.content).toBe('![](https://example.com/a.png)')
    expect(result.cursor).toBe(2)
  })

  test('inserts into whitespace-only content without a separator', () => {
    const result = insertInlineImage('   \n  ', 'https://example.com/a.png')

    expect(result.content).toBe('![](https://example.com/a.png)')
    expect(result.cursor).toBe(2)
  })

  test('cursor always lands right after the "![" of the inserted snippet', () => {
    const cases: Array<[string, { start: number; end: number } | undefined]> = [
      ['', undefined],
      ['Some content', undefined],
      ['Some content', { start: 5, end: 5 }],
      ['Some content', { start: 5, end: 9 }],
    ]

    for (const [content, selection] of cases) {
      const result = insertInlineImage(content, 'https://example.com/a.png', selection)
      expect(result.cursor).toBe(result.content.indexOf('![') + 2)
    }
  })
})
