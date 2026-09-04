import got, { OptionsOfTextResponseBody } from 'got'
import { Readable } from 'stream'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BugReport } from '../common/bugs'
import { asMockedFunction } from '../common/testing/mocks'
import { makeSbUserId } from '../common/users/sb-user-id'
import { getBugReport } from './lib/bugs/bugs-model'
import { InternalBugReportApi } from './lib/bugs/internal-bug-report-api'
import { readFileStream } from './lib/files'
import {
  InternalApiTestServer,
  PUBLIC_ROUTE_STACK_BODY,
  startInternalApiTestServer,
} from './lib/http/testing/internal-api-server'

vi.mock('./lib/bugs/bugs-model', () => ({
  getBugReport: vi.fn(),
}))
vi.mock('./lib/files', () => ({
  readFileStream: vi.fn(),
}))

const mockGetBugReport = asMockedFunction(getBugReport)
const mockReadFileStream = asMockedFunction(readFileStream)

const REPORT_ID = '123e4567-e89b-12d3-a456-426614174000'

const REPORT: BugReport = {
  id: REPORT_ID,
  submitterId: makeSbUserId(123),
  details: 'What the reporter entered',
  logsDeleted: false,
  createdAt: new Date(1787700000000),
}

const NO_THROW: OptionsOfTextResponseBody = { throwHttpErrors: false, retry: { limit: 0 } }

describe('server/internal-routes', () => {
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

  test('returns report metadata with no-store/nosniff headers', async () => {
    mockGetBugReport.mockResolvedValue(REPORT)

    const res = await got(`${baseUrl}/internal/bug-reports/${REPORT_ID}`, NO_THROW)

    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(JSON.parse(res.body)).toEqual({
      report: {
        id: REPORT_ID,
        submitterId: 123,
        details: 'What the reporter entered',
        logsDeleted: false,
        createdAt: 1787700000000,
      },
    })
  })

  test('streams the stored logs zip with download headers', async () => {
    const zipBytes = Buffer.from('PKnot really a zip', 'utf8')
    mockGetBugReport.mockResolvedValue(REPORT)
    mockReadFileStream.mockResolvedValue({
      stream: Readable.from([zipBytes]),
      size: zipBytes.length,
    })

    const res = await got(`${baseUrl}/internal/bug-reports/${REPORT_ID}/logs`, {
      ...NO_THROW,
      responseType: 'buffer',
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/zip')
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${REPORT_ID}-logs.zip"`)
    expect(res.headers['content-length']).toBe(String(zipBytes.length))
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(Buffer.compare(res.body, zipBytes)).toBe(0)
    expect(mockReadFileStream).toHaveBeenCalledWith(`bug-reports/${REPORT_ID}.zip`)
  })

  test('rejects reverse-proxied requests before touching any data', async () => {
    const res = await got(`${baseUrl}/internal/bug-reports/${REPORT_ID}`, {
      ...NO_THROW,
      headers: { 'X-Forwarded-For': '203.0.113.7' },
    })

    expect(res.statusCode).toBe(403)
    expect(mockGetBugReport).not.toHaveBeenCalled()
  })

  test('404s an unknown report', async () => {
    mockGetBugReport.mockResolvedValue(undefined)

    const res = await got(`${baseUrl}/internal/bug-reports/${REPORT_ID}`, NO_THROW)

    expect(res.statusCode).toBe(404)
  })

  test('400s a malformed report id without querying', async () => {
    const res = await got(`${baseUrl}/internal/bug-reports/not-a-uuid`, NO_THROW)

    expect(res.statusCode).toBe(400)
    expect(mockGetBugReport).not.toHaveBeenCalled()
  })

  test('410s logs that have been deleted', async () => {
    mockGetBugReport.mockResolvedValue({ ...REPORT, logsDeleted: true })

    const res = await got(`${baseUrl}/internal/bug-reports/${REPORT_ID}/logs`, NO_THROW)

    expect(res.statusCode).toBe(410)
    expect(mockReadFileStream).not.toHaveBeenCalled()
  })

  test('405s non-GET methods on a known path', async () => {
    const res = await got(`${baseUrl}/internal/bug-reports/${REPORT_ID}`, {
      ...NO_THROW,
      method: 'POST',
    })

    expect(res.statusCode).toBe(405)
  })

  test('never falls through to the public route stack for internal paths', async () => {
    const extended = await got(`${baseUrl}/internal/bug-reports/${REPORT_ID}/logs/extra`, NO_THROW)
    expect(extended.statusCode).toBe(404)
    expect(extended.body).not.toContain(PUBLIC_ROUTE_STACK_BODY)

    const unknown = await got(`${baseUrl}/internal/some-other-thing`, NO_THROW)
    expect(unknown.statusCode).toBe(404)
    expect(unknown.body).not.toContain(PUBLIC_ROUTE_STACK_BODY)
  })

  test('passes non-internal paths through untouched', async () => {
    const res = await got(`${baseUrl}/anything-else`, NO_THROW)

    expect(res.statusCode).toBe(200)
    expect(res.body).toBe(PUBLIC_ROUTE_STACK_BODY)
  })
})
