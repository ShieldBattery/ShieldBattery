import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { Readable } from 'stream'
import { BugReport, BugReportJson, toBugReportJson } from '../../../common/bugs'
import { urlPath } from '../../../common/urls'
import { readFileStream } from '../files'
import { setAttachmentHeaders } from '../http/attachment-headers'
import { httpBeforeAll, internalApi } from '../http/http-api'
import { internalResponseHeaders } from '../http/internal-response-headers'
import { httpGet } from '../http/route-decorators'
import { validateRequest } from '../validation/joi-validator'
import { getBugReport, listBugReportsPage } from './bugs-model'

/**
 * Response shape for `GET /internal/bug-reports/:reportId`. Unlike the staff-facing
 * `GetBugReportResponseJson`, this carries only the report itself: machine callers don't need user
 * display names resolved, and they fetch the logs through the internal `/logs` route rather than a
 * signed object-store URL.
 */
export interface InternalBugReportResponseJson {
  report: BugReportJson
}

/**
 * Response shape for `GET /internal/bug-reports`. Reports are newest first; `nextPath` is present
 * when more reports remain and fetches the following page with the same filters.
 */
export interface InternalListBugReportsResponseJson {
  reports: BugReportJson[]
  nextPath?: string
}

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 100

const LIST_QUERY = Joi.object<{ includeResolved: boolean; before?: string; limit: number }>({
  includeResolved: Joi.boolean().default(false),
  before: Joi.string().uuid(),
  limit: Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
})

const REPORT_ID_PARAMS = Joi.object<{ reportId: string }>({
  reportId: Joi.string().uuid().required(),
})

async function getReportOr404(reportId: string): Promise<BugReport> {
  const report = await getBugReport(reportId)
  if (!report) {
    throw new httpErrors.NotFound('Bug report not found')
  }
  return report
}

/**
 * Bug report access for service-to-service callers. No application-level authentication is
 * required; reachability is restricted to the private network/tailnet by the internal mount, see
 * internal-routes.ts.
 */
@internalApi('/bug-reports')
@httpBeforeAll(internalResponseHeaders)
export class InternalBugReportApi {
  @httpGet('/')
  async listReports(ctx: RouterContext): Promise<InternalListBugReportsResponseJson> {
    const {
      query: { includeResolved, before, limit },
    } = validateRequest(ctx, { query: LIST_QUERY })
    // One extra row tells us whether another page exists without a separate count query.
    const reports = await listBugReportsPage({ includeResolved, before, limit: limit + 1 })
    if (!reports) {
      throw new httpErrors.NotFound('Bug report passed as before not found')
    }

    const page = reports.slice(0, limit)
    let nextPath: string | undefined
    if (reports.length > limit) {
      const nextQuery = new URLSearchParams({ before: page.at(-1)!.id, limit: String(limit) })
      if (includeResolved) {
        nextQuery.set('includeResolved', 'true')
      }
      nextPath = urlPath`/internal/bug-reports?${nextQuery}`
    }

    return { reports: page.map(r => toBugReportJson(r)), nextPath }
  }

  @httpGet('/:reportId')
  async getReport(ctx: RouterContext): Promise<InternalBugReportResponseJson> {
    const {
      params: { reportId },
    } = validateRequest(ctx, { params: REPORT_ID_PARAMS })
    const report = await getReportOr404(reportId)

    return { report: toBugReportJson(report) }
  }

  @httpGet('/:reportId/logs')
  async getLogs(ctx: RouterContext): Promise<Readable> {
    const {
      params: { reportId },
    } = validateRequest(ctx, { params: REPORT_ID_PARAMS })
    const report = await getReportOr404(reportId)
    if (report.logsDeleted) {
      throw new httpErrors.Gone('Bug report logs have been deleted')
    }

    const logs = await readFileStream(`bug-reports/${report.id}.zip`)
    setAttachmentHeaders(ctx, {
      contentType: 'application/zip',
      filename: `${report.id}-logs.zip`,
      length: logs.size,
    })
    return logs.stream
  }
}
