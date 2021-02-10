import Router, { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { container } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { USERNAME_MAXLENGTH, USERNAME_MINLENGTH, USERNAME_PATTERN } from '../../../common/constants'
import users from '../models/users'
import PartyService, {
  PartyServiceError,
  PartyServiceErrorCode,
  PartyUser,
} from '../parties/party-service'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { joiValidator } from '../validation/joi-validator'

const partyService = container.resolve(PartyService)

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

const clientIdSchema = Joi.object().keys({
  clientId: Joi.string().required(),
})

const invitesPostchema = clientIdSchema.keys({
  targets: Joi.array()
    .items(
      Joi.string()
        .min(USERNAME_MINLENGTH)
        .max(USERNAME_MAXLENGTH)
        .pattern(USERNAME_PATTERN)
        .required(),
    )
    .min(1)
    .required(),
})

const partyIdSchema = Joi.object().keys({
  partyId: Joi.string().required(),
})

const declineParamsSchema = partyIdSchema.keys({
  targetId: Joi.number(),
})

export default function (router: Router) {
  router
    .use(ensureLoggedIn)
    .post(
      '/invites',
      throttleMiddleware(invitesThrottle, ctx => ctx.session!.userId),
      joiValidator({ body: invitesPostchema }),
      invite,
    )
    .delete(
      '/invites/:partyId/:targetId',
      throttleMiddleware(invitesThrottle, ctx => ctx.session!.userId),
      joiValidator({ params: declineParamsSchema }),
      decline,
    )
    .post(
      '/:partyId',
      throttleMiddleware(partyThrottle, ctx => ctx.session!.userId),
      joiValidator({ params: partyIdSchema }),
      accept,
    )
}

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
      throw new httpErrors.Unauthorized(err.message)
    default:
      assertUnreachable(err.code as never)
  }
}

async function invite(ctx: RouterContext) {
  const { clientId, targets } = ctx.request.body

  try {
    const invites = await Promise.all<PartyUser>(
      targets.map(
        async (target: string): Promise<PartyUser> => {
          const foundTarget = await users.find(target)
          if (!foundTarget) {
            throw new httpErrors.NotFound('Target user not found')
          }

          // TODO(2Pac): Check if the target user has blocked invitations from the user issuing the
          // request. Or potentially use friends list when implemented.

          return { id: foundTarget.id, name: foundTarget.name } as PartyUser
        },
      ),
    )

    const leader: PartyUser = {
      id: ctx.session!.userId,
      name: ctx.session!.userName,
    }

    partyService.invite(leader, clientId, invites)

    ctx.status = 204
  } catch (err) {
    convertPartyServiceError(err)
  }
}

async function decline(ctx: RouterContext) {
  const { partyId, targetId } = ctx.params

  try {
    let leader: PartyUser | undefined
    let target: PartyUser = { id: ctx.session!.userId, name: ctx.session!.userName }

    // If the `targetId` is provided, that means the user issuing the request wants to cancel an
    // invite to someone else.
    if (targetId) {
      const foundTarget = await users.find(targetId)
      if (!foundTarget) {
        throw new httpErrors.NotFound('Target user not found')
      }

      leader = target
      target = { id: foundTarget.id, name: foundTarget.name } as PartyUser
    }

    partyService.removeInvite(partyId, target, leader)

    ctx.status = 204
  } catch (err) {
    convertPartyServiceError(err)
  }
}

async function accept(ctx: RouterContext) {
  const { partyId } = ctx.params
  const { clientId } = ctx.request.body

  try {
    const user: PartyUser = { id: ctx.session!.userId, name: ctx.session!.userName }
    partyService.acceptInvite(partyId, user, clientId)

    ctx.status = 204
  } catch (err) {
    convertPartyServiceError(err)
  }
}
