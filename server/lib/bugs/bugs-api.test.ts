import { RouterContext } from '@koa/router'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { BugReport } from '../../../common/bugs'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { writeFile } from '../files'
import { findUsersById } from '../users/user-model'
import { BugsApi } from './bugs-api'
import { createBugReport, listBugReportAppVersions, listBugReportsPage } from './bugs-model'

vi.mock('./bugs-model', async importOriginal => ({
  ...(await importOriginal<typeof import('./bugs-model')>()),
  createBugReport: vi.fn(),
  listBugReportAppVersions: vi.fn(),
  listBugReportsPage: vi.fn(),
}))
vi.mock('../files', () => ({
  deleteFile: vi.fn(),
  getSignedUrl: vi.fn(),
  writeFile: vi.fn(),
}))
vi.mock('../users/user-model', async importOriginal => ({
  ...(await importOriginal<typeof import('../users/user-model')>()),
  findUsersById: vi.fn(),
}))

const mockListBugReportsPage = asMockedFunction(listBugReportsPage)
const mockListBugReportAppVersions = asMockedFunction(listBugReportAppVersions)
const mockFindUsersById = asMockedFunction(findUsersById)
const mockCreateBugReport = asMockedFunction(createBugReport)

function makeReport(n: number, extra: Partial<BugReport> = {}): BugReport {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    submitterId: makeSbUserId(n),
    details: `report ${n}`,
    logsDeleted: false,
    createdAt: new Date(1787700000000 - n * 1000),
    ...extra,
  }
}

function makeApi() {
  const notify = vi.fn().mockResolvedValue(undefined)
  const api = new BugsApi(
    { now: () => 1787700000000 } as any,
    { notify } as any,
    { scheduleJob: vi.fn() } as any,
    { refresh: vi.fn() } as any,
  )
  return { api, notify }
}

function listCtx(query: Record<string, string>): RouterContext {
  return { request: { query } } as any
}

describe('bugs/bugs-api/BugsApi#listBugReports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListBugReportAppVersions.mockResolvedValue(['12.10.0', '12.9.0'])
    mockFindUsersById.mockResolvedValue([])
  })

  test('defaults to the first 50 unresolved reports, unfiltered', async () => {
    const { api } = makeApi()
    mockListBugReportsPage.mockResolvedValue([makeReport(1, { appVersion: '12.10.0' })])

    const result = await api.listBugReports(listCtx({}))

    expect(mockListBugReportsPage).toHaveBeenCalledWith({
      includeResolved: false,
      search: undefined,
      appVersion: undefined,
      before: undefined,
      limit: 51,
    })
    expect(result.hasMore).toBe(false)
    expect(result.appVersions).toEqual(['12.10.0', '12.9.0'])
    expect(result.reports).toHaveLength(1)
    expect(result.reports[0].appVersion).toBe('12.10.0')
  })

  test('passes filters through, trimming the search', async () => {
    const { api } = makeApi()
    mockListBugReportsPage.mockResolvedValue([])
    const before = makeReport(5).id

    await api.listBugReports(
      listCtx({
        includeResolved: 'true',
        search: '  abcd1234 ',
        appVersion: '12.4.0',
        before,
        limit: '20',
      }),
    )

    expect(mockListBugReportsPage).toHaveBeenCalledWith({
      includeResolved: true,
      search: 'abcd1234',
      appVersion: '12.4.0',
      before,
      limit: 21,
    })
  })

  test('trims the lookahead row into hasMore and loads only the shown users', async () => {
    const { api } = makeApi()
    const reports = [
      makeReport(1, { resolverId: makeSbUserId(100) }),
      makeReport(2, { submitterId: undefined }),
      makeReport(3),
    ]
    mockListBugReportsPage.mockResolvedValue(reports)

    const result = await api.listBugReports(listCtx({ limit: '2' }))

    expect(result.hasMore).toBe(true)
    expect(result.reports.map(r => r.id)).toEqual([reports[0].id, reports[1].id])
    expect(mockFindUsersById).toHaveBeenCalledWith([makeSbUserId(1), makeSbUserId(100)])
  })

  test('404s when the before report does not exist', async () => {
    const { api } = makeApi()
    mockListBugReportsPage.mockResolvedValue(undefined)

    const err = await api.listBugReports(listCtx({ before: makeReport(9).id })).catch(e => e)

    expect(err).toHaveProperty('status', 404)
  })

  test.each<Record<string, string>>([
    { limit: '0' },
    { limit: '101' },
    { limit: '1.5' },
    { before: 'not-a-uuid' },
    { includeResolved: 'maybe' },
    { appVersion: '1.0.0; DROP' },
    { appVersion: 'x'.repeat(33) },
    { search: 'x'.repeat(201) },
  ])('400s %o without querying', async query => {
    const { api } = makeApi()

    const err = await api.listBugReports(listCtx(query)).catch(e => e)

    expect(err).toHaveProperty('status', 400)
    expect(mockListBugReportsPage).not.toHaveBeenCalled()
  })
})

describe('bugs/bugs-api/BugsApi#reportBug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateBugReport.mockImplementation(
      async ({ submitterId, details, appVersion, createdAt }) =>
        makeReport(1, { submitterId, details, appVersion, createdAt }),
    )
    asMockedFunction(writeFile).mockResolvedValue(undefined)
  })

  function reportCtx(body: Record<string, string>): RouterContext {
    return {
      request: {
        body,
        files: { logs: { filepath: __filename, mimetype: 'application/zip' } },
      },
      session: { user: { id: makeSbUserId(7), name: 'Reporter' } },
    } as any
  }

  test('stores the app version and mentions it in the notification', async () => {
    const { api, notify } = makeApi()

    await api.reportBug(reportCtx({ details: 'it broke', appVersion: '12.4.0' }))

    expect(mockCreateBugReport).toHaveBeenCalledWith(
      expect.objectContaining({ details: 'it broke', appVersion: '12.4.0' }),
    )
    expect(notify.mock.calls[0][0].content).toContain('New bug report from: Reporter (v12.4.0)')
  })

  test('accepts reports without an app version', async () => {
    const { api, notify } = makeApi()

    await api.reportBug(reportCtx({ details: 'it broke' }))

    expect(mockCreateBugReport).toHaveBeenCalledWith(
      expect.objectContaining({ appVersion: undefined }),
    )
    expect(notify.mock.calls[0][0].content).toMatch(/^New bug report from: Reporter\n/)
  })

  test('rejects an invalid app version before storing anything', async () => {
    const { api } = makeApi()

    const err = await api
      .reportBug(reportCtx({ details: 'it broke', appVersion: 'x'.repeat(40) }))
      .catch(e => e)

    expect(err).toHaveProperty('status', 400)
    expect(mockCreateBugReport).not.toHaveBeenCalled()
  })
})
