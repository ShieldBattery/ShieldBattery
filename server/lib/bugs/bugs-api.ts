import { RouterContext } from '@koa/router'
import { createReadStream } from 'fs'
import httpErrors from 'http-errors'
import Joi from 'joi'
import {
  DEFAULT_BUG_REPORTS_PAGE_SIZE,
  GetBugReportResponseJson,
  ListBugReportsRequest,
  ListBugReportsResponseJson,
  MAX_BUG_REPORT_APP_VERSION_LENGTH,
  MAX_BUG_REPORT_SEARCH_LENGTH,
  MAX_BUG_REPORTS_PAGE_SIZE,
  ReportBugRequest,
  ReportBugResponse,
  toBugReportJson,
} from '../../../common/bugs'
import { SbUserId } from '../../../common/users/sb-user-id'
import { AdminReportCountsService } from '../admin/admin-report-counts-service'
import { DiscordWebhookNotifier } from '../discord/webhook-notifier'
import { deleteFile, getSignedUrl, writeFile } from '../files'
import { handleMultipartFiles } from '../files/handle-multipart-files'
import { httpApi } from '../http/http-api'
import { httpBefore, httpGet, httpPost } from '../http/route-decorators'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUserOrIp } from '../throttle/middleware'
import { Clock } from '../time/clock'
import { findUsersById } from '../users/user-model'
import { validateRequest } from '../validation/joi-validator'
import {
  createBugReport,
  deleteBugReport,
  findDeletableBugReports,
  getBugReport,
  listBugReportAppVersions,
  listBugReportsPage,
  markBugReportFilesDeleted,
  resolveBugReport,
} from './bugs-model'

const MAX_LOGS_FILE_SIZE = 25 * 1024 * 1024 // 25 MB

const APP_VERSION = Joi.string()
  .trim()
  .max(MAX_BUG_REPORT_APP_VERSION_LENGTH)
  .pattern(/^[\w.+-]+$/)

const LIST_QUERY = Joi.object<
  ListBugReportsRequest & Required<Pick<ListBugReportsRequest, 'includeResolved' | 'limit'>>
>({
  includeResolved: Joi.boolean().default(false),
  search: Joi.string().trim().allow('').max(MAX_BUG_REPORT_SEARCH_LENGTH),
  appVersion: APP_VERSION,
  before: Joi.string().uuid(),
  limit: Joi.number()
    .integer()
    .min(1)
    .max(MAX_BUG_REPORTS_PAGE_SIZE)
    .default(DEFAULT_BUG_REPORTS_PAGE_SIZE),
})

const reportThrottle = createThrottle('bugsReport', {
  rate: 1,
  burst: 10,
  window: 60000,
})

@httpApi('/bugs')
export class BugsApi {
  constructor(
    private clock: Clock,
    private webhookNotifier: DiscordWebhookNotifier,
    private jobScheduler: JobScheduler,
    private adminReportCounts: AdminReportCountsService,
  ) {
    const jobStartTime = new Date(this.clock.now())
    jobStartTime.setMinutes(jobStartTime.getMinutes() + 60)

    this.jobScheduler.scheduleJob(
      'lib/bugs#deleteOldBugReportFiles',
      jobStartTime,
      60 * 60 * 1000,
      async () => {
        const olderThan = new Date(this.clock.now())
        olderThan.setMinutes(olderThan.getMinutes() - 29.5 * 24 * 60)
        const toDelete = await findDeletableBugReports(olderThan)

        for (const reportId of toDelete) {
          try {
            // NOTE(tec27): No real point in using a transaction here because if the DB part fails
            // we can't roll back the file deletion
            // TODO(tec27): What's the error if the file doesn't exist? We should handle that and
            // clean up the DB in that case
            await deleteFile(`bug-reports/${reportId}.zip`)
            await markBugReportFilesDeleted(reportId)
          } catch (err: unknown) {
            logger.error({ err }, `failed to delete files from bug report ${reportId}`)
          }
        }
      },
    )
  }

  @httpPost('/')
  @httpBefore(
    throttleMiddleware(reportThrottle, throttleByUserOrIp),
    handleMultipartFiles(MAX_LOGS_FILE_SIZE),
  )
  async reportBug(ctx: RouterContext): Promise<ReportBugResponse> {
    const {
      body: { details, appVersion },
    } = validateRequest(ctx, {
      body: Joi.object<ReportBugRequest>({
        details: Joi.string().required(),
        appVersion: APP_VERSION,
      }),
    })

    if (
      !ctx.request.files?.logs ||
      Array.isArray(ctx.request.files.logs) ||
      ctx.request.files.logs.mimetype !== 'application/zip'
    ) {
      throw new httpErrors.BadRequest('A single logs file zip must be provided')
    }

    const logsStream = createReadStream(ctx.request.files.logs.filepath)

    // The logs file is keyed by the report's ID, so the row has to exist before it can be
    // uploaded. A report whose logs never made it is worse than no report at all (its download
    // link can't resolve), so it gets deleted again if the upload fails.
    const report = await createBugReport({
      submitterId: ctx.session?.user?.id,
      details: details.slice(0, 5000),
      appVersion,
      createdAt: new Date(this.clock.now()),
    })

    try {
      await writeFile(`bug-reports/${report.id}.zip`, logsStream, { acl: 'private' })
    } catch (err: unknown) {
      try {
        await deleteBugReport(report.id)
      } catch (deleteErr: unknown) {
        logger.error({ err: deleteErr }, `failed to delete bug report ${report.id} after upload`)
      }
      throw err
    }

    this.adminReportCounts.refresh('bugReports')

    // This is best-effort and doesn't affect the success of the request
    const sanitizedDetails = details.replace(/[\r\n]+/g, ' ')
    this.webhookNotifier
      .notify({
        content:
          `New bug report from: ${ctx.session?.user?.name ?? 'Unknown user'}` +
          `${appVersion ? ` (v${appVersion})` : ''}\n\n` +
          `> ${
            sanitizedDetails.length > 100 ? sanitizedDetails.slice(0, 100) + '…' : sanitizedDetails
          }\n\n` +
          `${process.env.SB_CANONICAL_HOST}/admin/bug-reports/${report.id}`,
      })
      .catch(err => {
        logger.error({ err }, `error notifying webhook for new bug report`)
      })

    return {}
  }

  @httpGet('/')
  @httpBefore(ensureLoggedIn, checkAllPermissions('manageBugReports'))
  async listBugReports(ctx: RouterContext): Promise<ListBugReportsResponseJson> {
    const {
      query: { includeResolved, search, appVersion, before, limit },
    } = validateRequest(ctx, { query: LIST_QUERY })

    const [reports, appVersions] = await Promise.all([
      // One extra row tells us whether another page exists without a separate count query.
      listBugReportsPage({ includeResolved, search, appVersion, before, limit: limit + 1 }),
      listBugReportAppVersions(),
    ])
    if (!reports) {
      throw new httpErrors.NotFound('Bug report passed as before not found')
    }

    const page = reports.slice(0, limit)
    const userIds = new Set(
      page.flatMap(r => [r.submitterId, r.resolverId]).filter(id => id !== undefined),
    )
    const users = await findUsersById(Array.from(userIds))

    return {
      reports: page.map(r => toBugReportJson(r)),
      users,
      hasMore: reports.length > limit,
      appVersions,
    }
  }

  @httpGet('/:reportId')
  @httpBefore(ensureLoggedIn, checkAllPermissions('manageBugReports'))
  async getBugReport(ctx: RouterContext): Promise<GetBugReportResponseJson> {
    const {
      params: { reportId },
    } = validateRequest(ctx, {
      params: Joi.object<{ reportId: string }>({
        reportId: Joi.string().required(),
      }),
    })

    const report = await getBugReport(reportId)
    if (!report) {
      throw httpErrors.NotFound('Bug report not found')
    }

    const userIds = new Set([report.submitterId, report.resolverId].filter(Boolean) as SbUserId[])
    const users = await findUsersById(Array.from(userIds))
    const submitterName =
      users.find(u => u.id === report.submitterId)?.name ?? `${report.submitterId}`
    const logsUrl = await (report.logsDeleted
      ? undefined
      : getSignedUrl(`bug-reports/${report.id}.zip`, {
          contentDisposition: `attachment; filename="${submitterName}-${report.id}-logs.zip"`,
        }))

    return {
      report: toBugReportJson(report),
      users,
      logsUrl,
    }
  }

  @httpPost('/:reportId/resolve')
  @httpBefore(ensureLoggedIn, checkAllPermissions('manageBugReports'))
  async resolveBugReport(ctx: RouterContext): Promise<void> {
    const {
      params: { reportId },
    } = validateRequest(ctx, {
      params: Joi.object<{ reportId: string }>({
        reportId: Joi.string().required(),
      }),
    })

    const report = await getBugReport(reportId)
    if (!report) {
      throw httpErrors.NotFound('Bug report not found')
    }

    if (report.resolvedAt) {
      throw httpErrors.Conflict('Bug report already resolved')
    }

    await resolveBugReport({
      reportId,
      resolvedAt: new Date(this.clock.now()),
      resolverId: ctx.session!.user.id,
    })
    this.adminReportCounts.refresh('bugReports')

    ctx.status = 204
  }
}
