import Router, { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'
import { container } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { PARTIES } from '../../../common/flags'
import {
  AcceptPartyInviteServerBody,
  InviteToPartyServerBody,
  PartyUser,
} from '../../../common/parties'
import { featureEnabled } from '../flags/feature-enabled'
import { httpApi, HttpApi } from '../http/http-api'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { findUserById } from '../users/user-model'
import { validateRequest } from '../validation/joi-validator'
import PartyService, { PartyServiceError, PartyServiceErrorCode } from './party-service'

const invitesThrottle = createThrottle('partyInvites', {
  rate: 40,
  burst: 60,
  window: 60000,
})

const partyThrottle = createThrottle('parties', {
  rate: 20,
  burst: 40,
  window: 60000,
})

function isPartyServiceError(error: Error): error is PartyServiceError {
  return error.hasOwnProperty('code')
}

function convertPartyServiceError(err: Error) {
  if (!isPartyServiceError(err)) {
    throw err
  }

  switch (err.code) {
    case PartyServiceErrorCode.PartyNotFound:
      throw new httpErrors.NotFound(err.message)
    case PartyServiceErrorCode.InsufficientPermissions:
      throw new httpErrors.Forbidden(err.message)
    case PartyServiceErrorCode.PartyFull:
      throw new httpErrors.Conflict(err.message)
    case PartyServiceErrorCode.UserOffline:
      throw new httpErrors.NotFound(err.message)
    case PartyServiceErrorCode.InvalidAction:
      throw new httpErrors.BadRequest(err.message)
    case PartyServiceErrorCode.NotificationFailure:
      throw new httpErrors.InternalServerError(err.message)
    default:
      assertUnreachable(err.code)
  }
}

async function convertPartyServiceErrors(ctx: RouterContext, next: Koa.Next) {
  try {
    await next()
  } catch (err) {
    convertPartyServiceError(err)
  }
}

@httpApi()
export class PartyApi extends HttpApi {
  constructor() {
    super('/parties')
    // NOTE(tec27): Just ensures the service gets initialized on app init
    container.resolve(PartyService)
  }

  applyRoutes(router: Router): void {
    router
      .use(featureEnabled(PARTIES), ensureLoggedIn, convertPartyServiceErrors)
      .post(
        '/invites',
        throttleMiddleware(invitesThrottle, ctx => String(ctx.session!.userId)),
        invite,
      )
      .delete(
        '/invites/:partyId',
        throttleMiddleware(invitesThrottle, ctx => String(ctx.session!.userId)),
        decline,
      )
      .delete(
        '/invites/:partyId/:targetId',
        throttleMiddleware(invitesThrottle, ctx => String(ctx.session!.userId)),
        removeInvite,
      )
      .post(
        '/:partyId',
        throttleMiddleware(partyThrottle, ctx => String(ctx.session!.userId)),
        accept,
      )
  }
}

async function invite(ctx: RouterContext) {
  const {
    body: { clientId, targetId },
  } = validateRequest(ctx, {
    body: Joi.object<InviteToPartyServerBody>({
      clientId: Joi.string().required(),
      targetId: Joi.number().min(1).required(),
    }),
  })

  const foundTarget = await findUserById(targetId)
  if (!foundTarget) {
    throw new httpErrors.NotFound('Target user not found')
  }

  // TODO(2Pac): Check if the target user has blocked invitations from the user issuing
  // the request. Or potentially use friends list when implemented.

  const invite: PartyUser = { id: foundTarget.id, name: foundTarget.name }
  const leader: PartyUser = {
    id: ctx.session!.userId,
    name: ctx.session!.userName,
  }

  const partyService = container.resolve(PartyService)
  partyService.invite(leader, clientId, invite)

  ctx.status = 204
}

async function decline(ctx: RouterContext) {
  const {
    params: { partyId },
  } = validateRequest(ctx, {
    params: Joi.object<{ partyId: string }>({
      partyId: Joi.string().required(),
    }),
  })

  const target: PartyUser = { id: ctx.session!.userId, name: ctx.session!.userName }

  const partyService = container.resolve(PartyService)
  partyService.decline(partyId, target)

  ctx.status = 204
}

async function removeInvite(ctx: RouterContext) {
  const {
    params: { partyId, targetId },
  } = validateRequest(ctx, {
    params: Joi.object<{ partyId: string; targetId: number }>({
      partyId: Joi.string().required(),
      targetId: Joi.number().required(),
    }),
  })

  const foundTarget = await findUserById(targetId)
  if (!foundTarget) {
    throw new httpErrors.NotFound('Target user not found')
  }

  const removingUser: PartyUser = { id: ctx.session!.userId, name: ctx.session!.userName }
  const target: PartyUser = { id: foundTarget.id, name: foundTarget.name }

  const partyService = container.resolve(PartyService)
  partyService.removeInvite(partyId, removingUser, target)

  ctx.status = 204
}

async function accept(ctx: RouterContext) {
  const {
    params: { partyId },
    body: { clientId },
  } = validateRequest(ctx, {
    params: Joi.object<{ partyId: string }>({
      partyId: Joi.string().required(),
    }),
    body: Joi.object<AcceptPartyInviteServerBody>({
      clientId: Joi.string().required(),
    }),
  })

  const user: PartyUser = { id: ctx.session!.userId, name: ctx.session!.userName }

  const partyService = container.resolve(PartyService)
  partyService.acceptInvite(partyId, user, clientId)

  ctx.status = 204
}
