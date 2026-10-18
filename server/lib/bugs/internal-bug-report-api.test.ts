import got, { OptionsOfTextResponseBody } from 'got'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BugReport } from '../../../common/bugs'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import {
  InternalApiTestServer,
  startInternalApiTestServer,
} from '../http/testing/internal-api-server'
import { getBugReport, listBugReportsPage } from './bugs-model'
import { InternalBugReportApi } from './internal-bug-report-api'

vi.mock('./bugs-model', () => ({
  getBugReport: vi.fn(),
  listBugReportsPage: vi.fn(),
}))
vi.mock('../files', () => ({
  readFileStream: vi.fn(),
}))

const mockGetBugReport = asMockedFunction(getBugReport)
const mockListBugReportsPage = asMockedFunction(listBugReportsPage)

const NO_THROW: OptionsOfTextResponseBody = { throwHttpErrors: false, retry: { limit: 0 } }

function makeReport(n: number): BugReport {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    submitterId: makeSbUserId(n),
    details: `report ${n}`,
    logsDeleted: false,
    createdAt: new Date(1787700000000 - n * 1000),
  }
}

describe('bugs/internal-bug-report-api', () => {
  let server: InternalApiTestServer
  let baseUrl: string

  beforeEach(async () => {
    vi.clearAllMocks()
    server = await startInternalApiTestServer([new InternalBugReportApi()])
    baseUrl = server.baseUrl
  })

  afterEach(async () => {
    await server.close()
  })

  describe('list', () => {
    test('defaults to the newest 50 unresolved reports, with no next page when they all fit', async () => {
      const reports = [makeReport(1), makeReport(2)]
      mockListBugReportsPage.mockResolvedValue(reports)

      const res = await got(`${baseUrl}/internal/bug-reports`, NO_THROW)

      expect(res.statusCode).toBe(200)
      expect(res.headers['cache-control']).toBe('private, no-store')
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(mockListBugReportsPage).toHaveBeenCalledWith({
        includeResolved: false,
        before: undefined,
        limit: 51,
      })
      const body = JSON.parse(res.body)
      expect(body.reports.map((r: { id: string }) => r.id)).toEqual(reports.map(r => r.id))
      expect(body.reports[0].createdAt).toBe(Number(reports[0].createdAt))
      expect(body.nextPath).toBeUndefined()
    })

    test('trims the lookahead row and links the next page from the last returned report', async () => {
      const reports = [makeReport(1), makeReport(2), makeReport(3)]
      mockListBugReportsPage.mockResolvedValue(reports)

      const res = await got(
        `${baseUrl}/internal/bug-reports?limit=2&includeResolved=true`,
        NO_THROW,
      )

      expect(res.statusCode).toBe(200)
      expect(mockListBugReportsPage).toHaveBeenCalledWith({
        includeResolved: true,
        before: undefined,
        limit: 3,
      })
      const body = JSON.parse(res.body)
      expect(body.reports.map((r: { id: string }) => r.id)).toEqual([reports[0].id, reports[1].id])
      expect(body.nextPath).toBe(
        `/internal/bug-reports?before=${reports[1].id}&limit=2&includeResolved=true`,
      )
    })

    test('the next page link fetches the following page with the same filters', async () => {
      const reports = [makeReport(1), makeReport(2)]
      mockListBugReportsPage.mockResolvedValueOnce(reports).mockResolvedValueOnce([])

      const first = JSON.parse(
        (await got(`${baseUrl}/internal/bug-reports?limit=1`, NO_THROW)).body,
      )
      const res = await got(`${baseUrl}${first.nextPath}`, NO_THROW)

      expect(res.statusCode).toBe(200)
      expect(mockListBugReportsPage).toHaveBeenLastCalledWith({
        includeResolved: false,
        before: reports[0].id,
        limit: 2,
      })
      expect(JSON.parse(res.body)).toEqual({ reports: [] })
    })

    test('404s when the before report does not exist', async () => {
      mockListBugReportsPage.mockResolvedValue(undefined)

      const res = await got(`${baseUrl}/internal/bug-reports?before=${makeReport(9).id}`, NO_THROW)

      expect(res.statusCode).toBe(404)
    })

    test.each(['limit=0', 'limit=101', 'limit=1.5', 'before=not-a-uuid'])(
      '400s %s without querying',
      async query => {
        const res = await got(`${baseUrl}/internal/bug-reports?${query}`, NO_THROW)

        expect(res.statusCode).toBe(400)
        expect(mockListBugReportsPage).not.toHaveBeenCalled()
      },
    )
  })

  describe('get', () => {
    test('returns a single report by id', async () => {
      const report = makeReport(1)
      mockGetBugReport.mockResolvedValue(report)

      const res = await got(`${baseUrl}/internal/bug-reports/${report.id}`, NO_THROW)

      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).report.id).toBe(report.id)
      expect(mockListBugReportsPage).not.toHaveBeenCalled()
    })
  })
})
