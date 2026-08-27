import got, { OptionsOfTextResponseBody } from 'got'
import http from 'http'
import Koa from 'koa'
import { AddressInfo } from 'net'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BugReport } from '../common/bugs'
import { asMockedFunction } from '../common/testing/mocks'
import { makeSbUserId } from '../common/users/sb-user-id'
import { internalRoutesMiddleware } from './internal-routes'
import { getBugReport } from './lib/bugs/bugs-model'
import { errorPayloadMiddleware } from './lib/errors/error-payload-middleware'
import { readFile } from './lib/files'

vi.mock('./lib/bugs/bugs-model', () => ({
  getBugReport: vi.fn(),
}))
vi.mock('./lib/files', () => ({
  readFile: vi.fn(),
}))

const mockGetBugReport = asMockedFunction(getBugReport)
const mockReadFile = asMockedFunction(readFile)

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
  let server: http.Server
  let baseUrl: string

  beforeEach(async () => {
    vi.clearAllMocks()

    const app = new Koa()
    // Swallow the error events errorPayloadMiddleware emits so expected 4xx tests don't log
    app.on('error', () => {})
    app
      .use(errorPayloadMiddleware())
      .use(internalRoutesMiddleware())
      .use(ctx => {
        ctx.body = 'public route stack'
      })

    const callback = app.callback()
    server = http.createServer((req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      callback(req, res)
    })
    await new Promise<void>(resolve => {
      server.listen(0, resolve)
    })
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()))
    })
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

  test('returns the stored logs zip with download headers', async () => {
    const zipBytes = Buffer.from('PKnot really a zip', 'utf8')
    mockGetBugReport.mockResolvedValue(REPORT)
    mockReadFile.mockResolvedValue(zipBytes)

    const res = await got(`${baseUrl}/internal/bug-reports/${REPORT_ID}/logs`, {
      ...NO_THROW,
      responseType: 'buffer',
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/zip')
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${REPORT_ID}-logs.zip"`)
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(Buffer.compare(res.body, zipBytes)).toBe(0)
    expect(mockReadFile).toHaveBeenCalledWith(`bug-reports/${REPORT_ID}.zip`)
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

  test('404s a malformed report id without querying', async () => {
    const res = await got(`${baseUrl}/internal/bug-reports/not-a-uuid`, NO_THROW)

    expect(res.statusCode).toBe(404)
    expect(mockGetBugReport).not.toHaveBeenCalled()
  })

  test('410s logs that have been deleted', async () => {
    mockGetBugReport.mockResolvedValue({ ...REPORT, logsDeleted: true })

    const res = await got(`${baseUrl}/internal/bug-reports/${REPORT_ID}/logs`, NO_THROW)

    expect(res.statusCode).toBe(410)
    expect(mockReadFile).not.toHaveBeenCalled()
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
    expect(extended.body).not.toContain('public route stack')

    const unknown = await got(`${baseUrl}/internal/some-other-thing`, NO_THROW)
    expect(unknown.statusCode).toBe(404)
    expect(unknown.body).not.toContain('public route stack')
  })

  test('passes non-internal paths through untouched', async () => {
    const res = await got(`${baseUrl}/anything-else`, NO_THROW)

    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('public route stack')
  })
})
