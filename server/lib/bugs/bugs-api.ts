import { RouterContext } from '@koa/router'
import { createReadStream } from 'fs'
import httpErrors from 'http-errors'
import Joi from 'joi'
import {
  GetBugReportResponseJson,
  ListBugReportsResponseJson,
  ReportBugRequest,
  ReportBugResponse,
  toBugReportJson,
} from '../../../common/bugs'
import { SbUserId } from '../../../common/users/sb-user'
import transact from '../db/transaction'
import { DiscordWebhookNotifier } from '../discord/webhook-notifier'
import { deleteFile, getSignedUrl, writeFile } from '../file-upload'
import { handleMultipartFiles } from '../file-upload/handle-multipart-files'
import { httpApi } from '../http/http-api'
import { httpBefore, httpGet, httpPost } from '../http/route-decorators'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { Clock } from '../time/clock'
import { findUsersById } from '../users/user-model'
import { validateRequest } from '../validation/joi-validator'
import {
  createBugReport,
  findDeletableBugReports,
  getBugReport,
  listBugReports,
  markBugReportFilesDeleted,
  resolveBugReport,
} from './bugs-model'

const MAX_LOGS_FILE_SIZE = 25 * 1024 * 1024 // 25 MB

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
            if (
              err instanceof SyntaxError ||
              err instanceof TypeError ||
              err instanceof ReferenceError ||
              err instanceof RangeError
            ) {
              throw err
            }

            logger.error({ err }, `failed to delete files from bug report ${reportId}`, err)
          }
        }
      },
    )
  }

  @httpPost('/')
  @httpBefore(
    throttleMiddleware(reportThrottle, ctx => String(ctx.session?.user?.id ?? ctx.ip)),
    handleMultipartFiles(MAX_LOGS_FILE_SIZE),
  )
  async reportBug(ctx: RouterContext): Promise<ReportBugResponse> {
    const {
      body: { details },
    } = validateRequest(ctx, {
      body: Joi.object<ReportBugRequest>({
        details: Joi.string().required(),
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

    await transact(async client => {
      const report = await createBugReport(client, {
        submitterId: ctx.session?.user?.id,
        details: details.slice(0, 5000),
        createdAt: new Date(this.clock.now()),
      })
      await writeFile(`bug-reports/${report.id}.zip`, logsStream, { acl: 'private' })

      // This is best-effort and doesn't affect the success of the request
      const sanitizedDetails = details.replace(/[\r\n]+/g, ' ')
      this.webhookNotifier
        .notify({
          content:
            `New bug report from: ${ctx.session?.user?.name ?? 'Unknown user'}\n\n` +
            `> ${
              sanitizedDetails.length > 100
                ? sanitizedDetails.slice(0, 100) + '…'
                : sanitizedDetails
            }\n\n` +
            `${process.env.SB_CANONICAL_HOST}/admin/bug-reports/${report.id}`,
        })
        .catch(err => {
          logger.error({ err }, `error notifying webhook for new bug report`)
        })
    })

    return {}
  }

  @httpGet('/')
  @httpBefore(ensureLoggedIn, checkAllPermissions('manageBugReports'))
  async listBugReports(ctx: RouterContext): Promise<ListBugReportsResponseJson> {
    const reports = await listBugReports(ctx.query.includeResolved !== undefined)
    const userIds = new Set(
      reports.flatMap(r => {
        if (r.submitterId && r.resolverId) {
          return [r.submitterId, r.resolverId]
        } else if (r.submitterId) {
          return [r.submitterId]
        } else if (r.resolverId) {
          return [r.resolverId]
        } else {
          return []
        }
      }),
    )
    const users = await findUsersById(Array.from(userIds))

    return {
      reports: reports.map(r => toBugReportJson(r)),
      users,
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
    const [users, logsUrl] = await Promise.all([
      findUsersById(Array.from(userIds)),
      report.logsDeleted ? undefined : getSignedUrl(`bug-reports/${report.id}.zip`),
    ])

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
      resolverId: ctx.session!.user!.id,
    })

    ctx.status = 204
  }
}
