import Router, { RouterContext } from '@koa/router'
import Joi from 'joi'
import { httpApi, HttpApi } from '../http/http-api'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import { validateRequest } from '../validation/joi-validator'
import { retrieveLogEntries } from './models'

@httpApi()
export class LogsApi extends HttpApi {
  constructor() {
    super('/admin/logs/')
  }

  applyRoutes(router: Router): void {
    router.use(ensureLoggedIn, checkAllPermissions('debug')).get('/', getLogs)
  }
}

interface GetLogsQuery {
  limit: number
  startDate?: Date
  endDate?: Date
  reqId?: string
  level: number
}

async function getLogs(ctx: RouterContext) {
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

  ctx.body = {
    entries: logEntries,
  }
}
