import Router, { RouterContext } from '@koa/router'
import { BadRequest, NotFound } from 'http-errors'
import Joi from 'joi'
import { container } from 'tsyringe'
import {
  AddRallyPointServerBody,
  AddRallyPointServerPayload,
  GetRallyPointServersPayload,
  UpdateRallyPointClientPingBody,
  UpdateRallyPointServerBody,
  UpdateRallyPointServerPayload,
} from '../../../common/rally-point'
import { httpApi, HttpApi } from '../http/http-api'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import { validateRequest } from '../validation/joi-validator'
import { ClientSocketsManager } from '../websockets/socket-groups'
import { retrieveRallyPointServers } from './models'
import { RallyPointService } from './rally-point-service'

@httpApi('/rally-point/')
export class RallyPointPingApi implements HttpApi {
  applyRoutes(router: Router): void {
    router.use(ensureLoggedIn).put('/pings/:userId/:clientId/:serverId', updateClientPing)
  }
}

interface UpdateClientPingParams {
  userId: number
  clientId: string
  serverId: number
}

async function updateClientPing(ctx: RouterContext) {
  const { params, body } = validateRequest(ctx, {
    params: Joi.object<UpdateClientPingParams>({
      userId: Joi.allow(ctx.session!.userId),
      clientId: Joi.string().required(),
      serverId: Joi.number().integer().min(0).required(),
    }),

    body: Joi.object<UpdateRallyPointClientPingBody>({
      ping: Joi.number().min(0).unsafe().required(),
    }),
  })

  const clientSocketsManager = container.resolve(ClientSocketsManager)
  const client = clientSocketsManager.getById(params.userId, params.clientId)

  if (!client) {
    throw new NotFound(`could not find a client with id ${params.clientId}`)
  }

  const rallyPointService = container.resolve(RallyPointService)
  rallyPointService.updatePing(client, params.serverId, body.ping)

  ctx.status = 204
}

@httpApi('/admin/rally-point/')
export class RallyPointAdminApi implements HttpApi {
  applyRoutes(router: Router): void {
    router
      .use(ensureLoggedIn, checkAllPermissions('manageRallyPointServers'))
      .get('/', getServers)
      .post('/', addServer)
      .put('/:serverId', updateServer)
  }
}

async function getServers(ctx: RouterContext) {
  const servers = await retrieveRallyPointServers()

  const result: GetRallyPointServersPayload = {
    servers,
  }

  ctx.body = result
}

async function addServer(ctx: RouterContext) {
  const { body } = validateRequest(ctx, {
    body: Joi.object<AddRallyPointServerBody>({
      description: Joi.string().max(64).required(),
      hostname: Joi.string().max(64).hostname().required(),
      port: Joi.number().integer().min(1).max(65535).required(),
    }),
  })

  const rallyPointService = container.resolve(RallyPointService)

  const server = await rallyPointService.addServer({
    description: body.description,
    hostname: body.hostname,
    port: body.port,
    enabled: true,
  })

  const result: AddRallyPointServerPayload = {
    server,
  }

  ctx.body = result
}

interface SpecificServerParams {
  serverId: number
}

async function updateServer(ctx: RouterContext) {
  const { params, body } = validateRequest(ctx, {
    params: Joi.object<SpecificServerParams>({
      serverId: Joi.number().integer().min(0).required(),
    }),
    body: Joi.object<UpdateRallyPointServerBody>({
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

  const rallyPointService = container.resolve(RallyPointService)

  const server = await rallyPointService.updateServer({
    id: body.id,
    enabled: body.enabled,
    description: body.description,
    hostname: body.hostname,
    port: body.port,
  })

  if (!server) {
    throw new NotFound('the specified server does not exist')
  }

  const result: UpdateRallyPointServerPayload = {
    server,
  }

  ctx.body = result
}
