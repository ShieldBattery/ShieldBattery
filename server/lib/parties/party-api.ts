import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { USERNAME_MAXLENGTH, USERNAME_MINLENGTH, USERNAME_PATTERN } from '../../../common/constants'
import {
  AcceptFindMatchAsPartyRequest,
  AcceptPartyInviteRequest,
  ChangePartyLeaderRequest,
  FindMatchAsPartyRequest,
  InviteIdToPartyRequest,
  InviteNameToPartyRequest,
  InviteToPartyRequest,
  PartyServiceErrorCode,
  SendPartyChatMessageRequest,
} from '../../../common/parties'
import { SbUser } from '../../../common/users/sb-user'
import { asHttpError } from '../errors/error-with-payload'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpPost } from '../http/route-decorators'
import { matchmakingPreferencesValidator } from '../matchmaking/matchmaking-validators'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { joiClientIdentifiers } from '../users/client-ids'
import { UserIdentifierManager } from '../users/user-identifier-manager'
import { findUserById, findUserByName } from '../users/user-model'
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

function convertPartyServiceError(err: unknown) {
  if (!(err instanceof PartyServiceError)) {
    throw err
  }

  switch (err.code) {
    case PartyServiceErrorCode.NotFoundOrNotInvited:
    case PartyServiceErrorCode.NotFoundOrNotInParty:
    case PartyServiceErrorCode.InvalidAction:
    case PartyServiceErrorCode.AlreadyMember:
    case PartyServiceErrorCode.InvalidSelfAction:
    case PartyServiceErrorCode.AlreadyInGameplayActivity:
      throw asHttpError(400, err)
    case PartyServiceErrorCode.InsufficientPermissions:
      throw asHttpError(403, err)
    case PartyServiceErrorCode.PartyFull:
      throw asHttpError(409, err)
    case PartyServiceErrorCode.UserNotFound:
    case PartyServiceErrorCode.UserOffline:
      throw asHttpError(404, err)
    case PartyServiceErrorCode.NotificationFailure:
      throw asHttpError(500, err)
    case PartyServiceErrorCode.Blocked:
      throw asHttpError(403, err)
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
@httpBeforeAll(ensureLoggedIn, convertPartyServiceErrors)
export class PartyApi {
  constructor(private partyService: PartyService, private userIdManager: UserIdentifierManager) {}

  @httpPost('/invites')
  @httpBefore(throttleMiddleware(invitesThrottle, ctx => String(ctx.session!.userId)))
  async invite(ctx: RouterContext): Promise<void> {
    const { body } = validateRequest(ctx, {
      body: Joi.alternatives().try(
        Joi.object<InviteIdToPartyRequest>({
          clientId: Joi.string().required(),
          targetId: Joi.number().min(1).required(),
        }),
        Joi.object<InviteNameToPartyRequest>({
          clientId: Joi.string().required(),
          // TODO(tec27): Put this validator somewhere common
          targetName: Joi.string()
            .min(USERNAME_MINLENGTH)
            .max(USERNAME_MAXLENGTH)
            .pattern(USERNAME_PATTERN)
            .required(),
        }),
        // NOTE(tec27): This dumb cast is just to make our return types happy, since
        // AlternativesSchema doesn't have a type parameter :(
      ) as unknown as Joi.ObjectSchema<InviteToPartyRequest>,
    })

    const { clientId } = body
    let foundTarget: SbUser | undefined
    if ('targetId' in body) {
      foundTarget = await findUserById(body.targetId)
    } else if ('targetName' in body) {
      foundTarget = await findUserByName(body.targetName)
    }

    if (!foundTarget) {
      throw new httpErrors.NotFound('Target user not found')
    }

    // TODO(2Pac): Check if the target user has blocked invitations from the user issuing
    // the request. Or potentially use friends list when implemented.

    await this.partyService.invite(ctx.session!.userId, clientId, foundTarget)

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

    this.partyService.decline(partyId, ctx.session!.userId)

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

    await this.partyService.removeInvite(partyId, ctx.session!.userId, foundTarget.id)

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
      body: Joi.object<AcceptPartyInviteRequest>({
        clientId: Joi.string().required(),
      }),
    })

    const user = await findUserById(ctx.session!.userId)
    if (!user) {
      throw new Error("current user couldn't be found")
    }

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

      this.partyService.kickPlayer(partyId, ctx.session!.userId, foundTarget.id)
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
      body: Joi.object<SendPartyChatMessageRequest>({
        message: Joi.string().min(1).required(),
      }),
    })

    const user = await findUserById(ctx.session!.userId)
    if (!user) {
      throw new Error("current user couldn't be found")
    }

    this.partyService.sendChatMessage(partyId, user, message)

    ctx.status = 204
  }

  @httpPost('/:partyId/change-leader')
  @httpBefore(throttleMiddleware(partyThrottle, ctx => String(ctx.session!.userId)))
  async changeLeader(ctx: RouterContext): Promise<void> {
    const {
      params: { partyId },
      body: { targetId },
    } = validateRequest(ctx, {
      params: Joi.object<{ partyId: string; message: string }>({
        partyId: Joi.string().required(),
      }),
      body: Joi.object<ChangePartyLeaderRequest>({
        targetId: Joi.number().required(),
      }),
    })

    const foundTarget = await findUserById(targetId)
    if (!foundTarget) {
      throw new httpErrors.NotFound('Target user not found')
    }

    this.partyService.changeLeader(partyId, ctx.session!.userId, foundTarget.id)

    ctx.status = 204
  }

  @httpPost('/:partyId/find-match')
  @httpBefore(throttleMiddleware(partyThrottle, ctx => String(ctx.session!.userId)))
  async findMatch(ctx: RouterContext): Promise<void> {
    const {
      params: { partyId },
      body: { preferences, identifiers },
    } = validateRequest(ctx, {
      params: Joi.object<{ partyId: string }>({
        partyId: Joi.string().required(),
      }),
      body: Joi.object<FindMatchAsPartyRequest>({
        preferences: matchmakingPreferencesValidator(ctx.session!.userId).required(),
        identifiers: joiClientIdentifiers().required(),
      }),
    })

    await this.userIdManager.upsert(ctx.session!.userId, identifiers)
    if (await this.userIdManager.banUserIfNeeded(ctx.session!.userId)) {
      throw new httpErrors.UnauthorizedError('This account is banned')
    }

    await this.partyService.findMatch(partyId, ctx.session!.userId, identifiers, preferences)
  }

  @httpPost('/:partyId/find-match/:queueId')
  @httpBefore(throttleMiddleware(partyThrottle, ctx => String(ctx.session!.userId)))
  async acceptFindMatch(ctx: RouterContext): Promise<void> {
    const {
      params: { partyId, queueId },
      body: { race, identifiers },
    } = validateRequest(ctx, {
      params: Joi.object<{ partyId: string; queueId: string }>({
        partyId: Joi.string().required(),
        queueId: Joi.string().required(),
      }),
      body: Joi.object<AcceptFindMatchAsPartyRequest>({
        race: Joi.string().valid('p', 'r', 't', 'z').required(),
        identifiers: joiClientIdentifiers().required(),
      }),
    })

    await this.userIdManager.upsert(ctx.session!.userId, identifiers)
    if (await this.userIdManager.banUserIfNeeded(ctx.session!.userId)) {
      throw new httpErrors.UnauthorizedError('This account is banned')
    }

    this.partyService.acceptFindMatch(partyId, queueId, ctx.session!.userId, identifiers, race)
  }

  @httpDelete('/:partyId/find-match/:queueId')
  @httpBefore(throttleMiddleware(partyThrottle, ctx => String(ctx.session!.userId)))
  async rejectFindMatch(ctx: RouterContext): Promise<void> {
    const {
      params: { partyId, queueId },
    } = validateRequest(ctx, {
      params: Joi.object<{ partyId: string; queueId: string }>({
        partyId: Joi.string().required(),
        queueId: Joi.string().required(),
      }),
    })

    this.partyService.rejectFindMatch(partyId, queueId, ctx.session!.userId)
  }
}
