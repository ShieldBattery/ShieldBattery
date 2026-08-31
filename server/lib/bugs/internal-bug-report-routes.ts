import KoaRouter, { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import { BugReportJson, toBugReportJson } from '../../../common/bugs'
import { readFile } from '../files'
import { getBugReport } from './bugs-model'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Response shape for `GET /internal/bug-reports/:reportId`. Unlike the staff-facing
 * `GetBugReportResponseJson`, this carries only the report itself: machine callers don't need user
 * display names resolved, and they fetch the logs through the internal `/logs` route rather than a
 * signed object-store URL.
 */
export interface InternalBugReportResponseJson {
  report: BugReportJson
}

function setInternalResponseHeaders(ctx: RouterContext) {
  ctx.set('Cache-Control', 'private, no-store')
  ctx.set('X-Content-Type-Options', 'nosniff')
}

async function getReportOr404(reportId: string) {
  // The id column is a Postgres `uuid`, so a malformed id would error inside the query rather
  // than return no rows. Checking the shape here keeps that from turning into a 500, and callers
  // can't distinguish a malformed id from an unknown one.
  if (!UUID_REGEX.test(reportId)) {
    throw new httpErrors.NotFound('Bug report not found')
  }
  const report = await getBugReport(reportId)
  if (!report) {
    throw new httpErrors.NotFound('Bug report not found')
  }
  return report
}

/**
 * Registers the bug report routes for service-to-service callers (`GET /bug-reports/:reportId`
 * and `GET /bug-reports/:reportId/logs`, relative to the internal router's mount). No
 * application-level authentication is required — reachability is restricted to the private
 * network/tailnet by the internal router's mounting; see internal-routes.ts.
 */
export function registerInternalBugReportRoutes(router: KoaRouter) {
  router.get('/bug-reports/:reportId', async ctx => {
    const report = await getReportOr404(ctx.params.reportId)

    setInternalResponseHeaders(ctx)
    const response: InternalBugReportResponseJson = { report: toBugReportJson(report) }
    ctx.body = response
  })

  router.get('/bug-reports/:reportId/logs', async ctx => {
    const report = await getReportOr404(ctx.params.reportId)
    if (report.logsDeleted) {
      throw new httpErrors.Gone('Bug report logs have been deleted')
    }

    // Upload size is capped at 25 MiB (see MAX_LOGS_FILE_SIZE in bugs-api.ts), so buffering the
    // whole file is acceptable; a streaming FileStore read would reduce peak memory if that cap
    // ever grows.
    const logs = await readFile(`bug-reports/${report.id}.zip`)

    setInternalResponseHeaders(ctx)
    ctx.set('Content-Type', 'application/zip')
    ctx.set('Content-Disposition', `attachment; filename="${report.id}-logs.zip"`)
    ctx.body = logs
  })
}
