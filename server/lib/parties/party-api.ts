import Router, { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { PARTIES } from '../../../common/flags'
import {
  AcceptPartyInviteServerBody,
  ChangeLeaderServerBody,
  InviteToPartyServerBody,
  PartyServiceErrorCode,
  PartyUser,
  SendChatMessageServerBody,
} from '../../../common/parties'
import { asHttpError } from '../errors/error-with-payload'
import { featureEnabled } from '../flags/feature-enabled'
import { httpApi, HttpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpPost } from '../http/route-decorators'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { findUserById } from '../users/user-model'
import { validateRequest } from '../validation/joi-validator'
import PartyService, { PartyServiceError } from './party-service'

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

const sendChatMessageThrottle = createThrottle('partyChatMessage', {
  rate: 30,
  burst: 90,
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
    case PartyServiceErrorCode.NotFoundOrNotInvited:
    case PartyServiceErrorCode.NotFoundOrNotInParty:
    case PartyServiceErrorCode.InvalidAction:
    case PartyServiceErrorCode.AlreadyMember:
    case PartyServiceErrorCode.InvalidSelfAction:
      throw asHttpError(400, err)
    case PartyServiceErrorCode.InsufficientPermissions:
      throw asHttpError(403, err)
    case PartyServiceErrorCode.PartyFull:
      throw asHttpError(409, err)
    case PartyServiceErrorCode.UserOffline:
      throw asHttpError(404, err)
    case PartyServiceErrorCode.NotificationFailure:
      throw asHttpError(500, err)
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

@httpApi('/parties')
@httpBeforeAll(featureEnabled(PARTIES), ensureLoggedIn, convertPartyServiceErrors)
export class PartyApi implements HttpApi {
  constructor(private partyService: PartyService) {}

  applyRoutes(router: Router): void {}

  @httpPost('/invites')
  @httpBefore(throttleMiddleware(invitesThrottle, ctx => String(ctx.session!.userId)))
  async invite(ctx: RouterContext): Promise<void> {
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

    await this.partyService.invite(leader, clientId, invite)

    ctx.status = 204
  }

  @httpDelete('/invites/:partyId')
  @httpBefore(throttleMiddleware(invitesThrottle, ctx => String(ctx.session!.userId)))
  async decline(ctx: RouterContext): Promise<void> {
    const {
      params: { partyId },
    } = validateRequest(ctx, {
      params: Joi.object<{ partyId: string }>({
        partyId: Joi.string().required(),
      }),
    })

    const target: PartyUser = { id: ctx.session!.userId, name: ctx.session!.userName }
    this.partyService.decline(partyId, target)

    ctx.status = 204
  }

  @httpDelete('/invites/:partyId/:targetId')
  @httpBefore(throttleMiddleware(invitesThrottle, ctx => String(ctx.session!.userId)))
  async removeInvite(ctx: RouterContext): Promise<void> {
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

    await this.partyService.removeInvite(partyId, removingUser, target)

    ctx.status = 204
  }

  @httpPost('/:partyId')
  @httpBefore(throttleMiddleware(partyThrottle, ctx => String(ctx.session!.userId)))
  async accept(ctx: RouterContext): Promise<void> {
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
    await this.partyService.acceptInvite(partyId, user, clientId)

    ctx.status = 204
  }

  @httpDelete('/:partyId/:clientId')
  @httpBefore(throttleMiddleware(partyThrottle, ctx => String(ctx.session!.userId)))
  async leaveOrKick(ctx: RouterContext): Promise<void> {
    const {
      params: { partyId, clientId },
      query: { type },
    } = validateRequest(ctx, {
      params: Joi.object<{ partyId: string; clientId: string | number }>({
        partyId: Joi.string().required(),
        clientId: Joi.alternatives(Joi.number(), Joi.string()).required(),
      }),
      query: Joi.object<{ type: 'leave' | 'kick' }>({
        type: Joi.string().valid('leave', 'kick').required(),
      }),
    })

    if (type === 'leave') {
      this.partyService.leaveParty(partyId, ctx.session!.userId, String(clientId))
    } else if (type === 'kick') {
      if (typeof clientId !== 'number') {
        throw new httpErrors.BadRequest('clientId must be a number for kicking')
      }

      const foundTarget = await findUserById(clientId)
      if (!foundTarget) {
        throw new httpErrors.NotFound('Target user not found')
      }

      const kickingUser: PartyUser = { id: ctx.session!.userId, name: ctx.session!.userName }
      const target: PartyUser = { id: foundTarget.id, name: foundTarget.name }

      this.partyService.kickPlayer(partyId, kickingUser, target)
    } else {
      assertUnreachable(type)
    }

    ctx.status = 204
  }

  @httpPost('/:partyId/messages')
  @httpBefore(throttleMiddleware(sendChatMessageThrottle, ctx => String(ctx.session!.userId)))
  async sendChatMessage(ctx: RouterContext): Promise<void> {
    const {
      params: { partyId },
      body: { message },
    } = validateRequest(ctx, {
      params: Joi.object<{ partyId: string; message: string }>({
        partyId: Joi.string().required(),
      }),
      body: Joi.object<SendChatMessageServerBody>({
        message: Joi.string().min(1).required(),
      }),
    })

    this.partyService.sendChatMessage(partyId, ctx.session!.userId, message)

    ctx.status = 204
  }

  @httpPost('/:partyId/changeLeader')
  @httpBefore(throttleMiddleware(partyThrottle, ctx => String(ctx.session!.userId)))
  async changeLeader(ctx: RouterContext): Promise<void> {
    const {
      params: { partyId },
      body: { targetId },
    } = validateRequest(ctx, {
      params: Joi.object<{ partyId: string; message: string }>({
        partyId: Joi.string().required(),
      }),
      body: Joi.object<ChangeLeaderServerBody>({
        targetId: Joi.number().required(),
      }),
    })

    const foundTarget = await findUserById(targetId)
    if (!foundTarget) {
      throw new httpErrors.NotFound('Target user not found')
    }

    const oldLeader: PartyUser = { id: ctx.session!.userId, name: ctx.session!.userName }
    const newLeader: PartyUser = { id: foundTarget.id, name: foundTarget.name }

    this.partyService.changeLeader(partyId, oldLeader, newLeader)

    ctx.status = 204
  }
}
