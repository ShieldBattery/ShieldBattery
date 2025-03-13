import { RouterContext } from '@koa/router'
import { BadRequest, NotFound } from 'http-errors'
import Joi from 'joi'
import {
  AddRallyPointServerRequest,
  AddRallyPointServerResponse,
  GetRallyPointServersResponse,
  UpdateRallyPointClientPingBatchRequest,
  UpdateRallyPointServerRequest,
  UpdateRallyPointServerResponse,
} from '../../../common/rally-point'
import { SbUserId } from '../../../common/users/sb-user-id'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpGet, httpPost, httpPut } from '../http/route-decorators'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import { validateRequest } from '../validation/joi-validator'
import { ClientSocketsManager } from '../websockets/socket-groups'
import { retrieveRallyPointServers } from './models'
import { RallyPointService } from './rally-point-service'

interface UpdateClientPingBatchParams {
  userId: SbUserId
  clientId: string
}

@httpApi('/rally-point/')
@httpBeforeAll(ensureLoggedIn)
export class RallyPointPingApi {
  constructor(
    private rallyPointService: RallyPointService,
    private clientSocketsManager: ClientSocketsManager,
  ) {}

  @httpPut('/pings/:userId/:clientId/batch')
  async updateClientPingBatch(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: Joi.object<UpdateClientPingBatchParams>({
        userId: Joi.allow(ctx.session!.user!.id).required(),
        clientId: Joi.string().required(),
      }),

      body: Joi.object<UpdateRallyPointClientPingBatchRequest>({
        pings: Joi.array()
          .items(
            Joi.array()
              .ordered(Joi.number().integer().min(0).required(), Joi.number().min(0).required())
              .required(),
          )
          .required(),
      }),
    })

    const client = this.clientSocketsManager.getById(params.userId, params.clientId)

    if (!client) {
      throw new NotFound(`could not find a client with id ${params.clientId}`)
    }

    for (const [serverId, ping] of body.pings) {
      this.rallyPointService.updatePing(client, serverId, ping)
    }

    ctx.status = 204
  }
}

@httpApi('/admin/rally-point/')
@httpBeforeAll(ensureLoggedIn, checkAllPermissions('manageRallyPointServers'))
export class RallyPointAdminApi {
  constructor(private rallyPointService: RallyPointService) {}

  @httpGet('/')
  async getServers(ctx: RouterContext): Promise<GetRallyPointServersResponse> {
    const servers = await retrieveRallyPointServers()
    return { servers }
  }

  @httpPost('/')
  async addServer(ctx: RouterContext): Promise<AddRallyPointServerResponse> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<AddRallyPointServerRequest>({
        description: Joi.string().max(64).required(),
        hostname: Joi.string().max(64).hostname().required(),
        port: Joi.number().integer().min(1).max(65535).required(),
      }),
    })

    const server = await this.rallyPointService.addServer({
      description: body.description,
      hostname: body.hostname,
      port: body.port,
      enabled: true,
    })

    return { server }
  }

  @httpPut('/:serverId')
  async updateServer(ctx: RouterContext): Promise<UpdateRallyPointServerResponse> {
    const { params, body } = validateRequest(ctx, {
      params: Joi.object<{ serverId: number }>({
        serverId: Joi.number().integer().min(0).required(),
      }),
      body: Joi.object<UpdateRallyPointServerRequest>({
        id: Joi.number().integer().min(0).required(),
        enabled: Joi.boolean().required(),
        description: Joi.string().max(64).required(),
        hostname: Joi.string().max(64).hostname().required(),
        port: Joi.number().integer().min(1).max(65535).required(),
      }),
    })

    if (params.serverId !== body.id) {
      throw new BadRequest('url and body id must match')
    }

    const server = await this.rallyPointService.updateServer({
      id: body.id,
      enabled: body.enabled,
      description: body.description,
      hostname: body.hostname,
      port: body.port,
    })

    if (!server) {
      throw new NotFound('the specified server does not exist')
    }

    return { server }
  }
}
