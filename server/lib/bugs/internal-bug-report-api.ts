import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { Readable } from 'stream'
import { BugReport, BugReportJson, toBugReportJson } from '../../../common/bugs'
import { readFileStream } from '../files'
import { setAttachmentHeaders } from '../http/attachment-headers'
import { httpBeforeAll, internalApi } from '../http/http-api'
import { internalResponseHeaders } from '../http/internal-response-headers'
import { httpGet } from '../http/route-decorators'
import { validateRequest } from '../validation/joi-validator'
import { getBugReport } from './bugs-model'

/**
 * Response shape for `GET /internal/bug-reports/:reportId`. Unlike the staff-facing
 * `GetBugReportResponseJson`, this carries only the report itself: machine callers don't need user
 * display names resolved, and they fetch the logs through the internal `/logs` route rather than a
 * signed object-store URL.
 */
export interface InternalBugReportResponseJson {
  report: BugReportJson
}

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
