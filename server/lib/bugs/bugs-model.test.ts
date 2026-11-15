import { describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import db from '../db'
import { listBugReportAppVersions, listBugReportsPage } from './bugs-model'

vi.mock('../db', () => ({
  default: vi.fn(),
}))

/** Stubs `db()` to hand back a fake client whose `query` calls are captured for assertions. */
function mockDbClient(...results: Array<Array<Record<string, unknown>>>) {
  const query = vi.fn()
  for (const rows of results) {
    query.mockResolvedValueOnce({ rows, rowCount: rows.length })
  }
  const done = vi.fn()
  asMockedFunction(db).mockResolvedValue({ client: { query } as any, done })
  return { query, done }
}

/* eslint-disable eslint-core/camelcase */
const REPORT_ROW = {
  id: '0123abcd-0000-4000-8000-000000000001',
  submitter_id: 7,
  details: 'it broke',
  logs_deleted: false,
  created_at: new Date('2026-11-01T00:00:00Z'),
  resolved_at: null,
  resolver_id: null,
  app_version: '12.4.0',
}
/* eslint-enable eslint-core/camelcase */

describe('bugs/bugs-model/listBugReportsPage', () => {
  test('lists unresolved reports newest first with no search conditions', async () => {
    const { query, done } = mockDbClient([REPORT_ROW])

    const reports = await listBugReportsPage({ includeResolved: false, limit: 51 })

    expect(reports).toEqual([
      {
        id: REPORT_ROW.id,
        submitterId: 7,
        details: 'it broke',
        logsDeleted: false,
        createdAt: REPORT_ROW.created_at,
        resolvedAt: undefined,
        resolverId: undefined,
        appVersion: '12.4.0',
      },
    ])
    expect(query).toHaveBeenCalledTimes(1)
    const { text, values } = query.mock.calls[0][0]
    expect(text).toMatch(
      /WHERE br\.resolved_at IS NULL\s+ORDER BY br\.created_at DESC, br\.id DESC/,
    )
    expect(text).not.toContain('ILIKE')
    expect(values).toEqual([51])
    expect(done).toHaveBeenCalled()
  })

  test('includes resolved reports without any WHERE clause', async () => {
    const { query } = mockDbClient([])

    await listBugReportsPage({ includeResolved: true, limit: 10 })

    expect(query.mock.calls[0][0].text).not.toContain('WHERE')
  })

  test('filters by exact app version', async () => {
    const { query } = mockDbClient([])

    await listBugReportsPage({ includeResolved: true, appVersion: '12.4.0', limit: 10 })

    const { text, values } = query.mock.calls[0][0]
    expect(text).toMatch(/WHERE br\.app_version = \$1/)
    expect(values).toEqual(['12.4.0', 10])
  })

  test('matches a trimmed search against id, details and submitter name in one statement', async () => {
    const { query } = mockDbClient([])

    await listBugReportsPage({ includeResolved: false, search: '  0123ABCD ', limit: 10 })

    expect(query).toHaveBeenCalledTimes(1)
    const { text, values } = query.mock.calls[0][0]
    expect(text).toContain('LEFT JOIN users u ON u.id = br.submitter_id')
    expect(text).toMatch(
      /br\.resolved_at IS NULL AND \(br\.id::text ILIKE \$1 OR br\.details ILIKE \$2 OR u\.name ILIKE \$3\)/,
    )
    expect(text).not.toContain('submitter_id =')
    expect(values).toEqual(['%0123ABCD%', '%0123ABCD%', '%0123ABCD%', 10])
  })

  test('escapes LIKE wildcards in the search text', async () => {
    const { query } = mockDbClient([])

    await listBugReportsPage({ includeResolved: true, search: '50%_off\\', limit: 10 })

    expect(query.mock.calls[0][0].values[0]).toBe('%50\\%\\_off\\\\%')
  })

  test('an all-digit search also matches the submitter id', async () => {
    const { query } = mockDbClient([])

    await listBugReportsPage({ includeResolved: true, search: '42', limit: 10 })

    const { text, values } = query.mock.calls[0][0]
    expect(text).toMatch(/u\.name ILIKE \$3 OR br\.submitter_id = \$4\)/)
    expect(values).toEqual(['%42%', '%42%', '%42%', 42, 10])
  })

  test('a digit search too large for a user id only matches as text', async () => {
    const { query } = mockDbClient([])

    await listBugReportsPage({ includeResolved: true, search: '99999999999', limit: 10 })

    expect(query.mock.calls[0][0].text).not.toContain('submitter_id =')
  })

  test('a blank search adds no conditions', async () => {
    const { query } = mockDbClient([])

    await listBugReportsPage({ includeResolved: true, search: '   ', limit: 10 })

    expect(query.mock.calls[0][0].text).not.toContain('ILIKE')
  })

  test('pages after the before report, combined with the filters', async () => {
    const before = '0123abcd-0000-4000-8000-000000000009'
    const { query } = mockDbClient([{ '?column?': 1 }], [REPORT_ROW])

    await listBugReportsPage({ includeResolved: false, search: 'crash', before, limit: 10 })

    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[0][0].values).toEqual([before])
    const { text, values } = query.mock.calls[1][0]
    expect(text).toMatch(
      /\(br\.created_at, br\.id\) < \(SELECT created_at, id FROM bug_reports WHERE id = \$4\)/,
    )
    expect(values).toEqual(['%crash%', '%crash%', '%crash%', before, 10])
  })

  test('returns undefined when the before report does not exist', async () => {
    const { query } = mockDbClient([])

    expect(
      await listBugReportsPage({
        includeResolved: false,
        before: '0123abcd-0000-4000-8000-000000000009',
        limit: 10,
      }),
    ).toBeUndefined()
    expect(query).toHaveBeenCalledTimes(1)
  })
})

describe('bugs/bugs-model/listBugReportAppVersions', () => {
  test('returns distinct versions newest first, ordered numerically', async () => {
    /* eslint-disable eslint-core/camelcase */
    mockDbClient([
      { app_version: '12.9.0' },
      { app_version: '12.10.0' },
      { app_version: '9.0.0' },
      { app_version: '12.10.1' },
    ])
    /* eslint-enable eslint-core/camelcase */

    expect(await listBugReportAppVersions()).toEqual(['12.10.1', '12.10.0', '12.9.0', '9.0.0'])
  })
})
