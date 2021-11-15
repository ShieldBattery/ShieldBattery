import { RouterContext } from '@koa/router'
import Joi from 'joi'
import { GetLogsPayload } from '../../../common/admin/server-logs'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpGet } from '../http/route-decorators'
import { JobScheduler } from '../jobs/job-scheduler'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import { validateRequest } from '../validation/joi-validator'
import { deleteOldLogs, retrieveLogEntries } from './models'

interface GetLogsQuery {
  limit: number
  startDate?: Date
  endDate?: Date
  reqId?: string
  level: number
}

@httpApi('/admin/logs')
@httpBeforeAll(ensureLoggedIn, checkAllPermissions('debug'))
export class LogsApi {
  constructor(private jobScheduler: JobScheduler) {
    const curTime = new Date()
    const startTime = new Date()
    // Clear old logs every day at 11AM UTC
    startTime.setUTCHours(11, 0, 0, 0)
    if (startTime < curTime) {
      startTime.setDate(startTime.getDate() + 1)
    }
    this.jobScheduler.scheduleJob(
      'lib/logs#deleteOldLogs',
      startTime,
      // 24 hours
      24 * 60 * 60 * 1000,
      async () => {
        await deleteOldLogs()
      },
    )
  }

  @httpGet('/')
  async getLogs(ctx: RouterContext): Promise<GetLogsPayload> {
    const { query } = validateRequest(ctx, {
      query: Joi.object<GetLogsQuery>({
        limit: Joi.number().default(100),
        startDate: Joi.date().timestamp('javascript'),
        endDate: Joi.date().timestamp('javascript'),
        reqId: Joi.string(),
        level: Joi.number().min(0).max(100),
      }),
    })

    const logEntries = await retrieveLogEntries(query)
    return { entries: logEntries }
  }
}
