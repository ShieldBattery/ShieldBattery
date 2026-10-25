import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import koaBody from 'koa-body'
import { SbUserId } from '../../../common/users/sb-user-id'
import { httpBeforeAll, internalApi } from '../http/http-api'
import { internalResponseHeaders } from '../http/internal-response-headers'
import { httpPost } from '../http/route-decorators'
import { validateRequest } from '../validation/joi-validator'
import { BanEnacter } from './ban-enacter'
import { BanRequestConflict } from './ban-request-models'
import { ClientIdentifierString } from './client-ids'
import { IdentifierObservationConflict } from './identifier-observation-models'
import { IdentifierReconciliationService } from './identifier-reconciliation-service'
import { moderationServiceAuth } from './moderation-service-auth'

const bodyParser = koaBody({
  json: true,
  jsonLimit: '8kb',
  multipart: false,
  urlencoded: false,
  text: false,
})

@internalApi('/users')
@httpBeforeAll(internalResponseHeaders)
export class InternalUserApi {
  private authorize = moderationServiceAuth(process.env.SB_MODERATION_SERVICE_TOKEN_FILE)

  constructor(
    private banEnacter: BanEnacter,
    private identifierReconciliation: IdentifierReconciliationService,
  ) {}

  @httpPost('/:userId/identifiers')
  async identifiers(ctx: RouterContext): Promise<{ requestId: string }> {
    this.authorize(ctx)
    if (!ctx.is('application/json')) throw new httpErrors.UnsupportedMediaType()
    await bodyParser(ctx, async () => {})
    const { params, body } = validateRequest(ctx, {
      params: Joi.object<{ userId: SbUserId }>({
        userId: Joi.number().integer().min(1).max(2147483647).required(),
      }),
      body: Joi.object<{
        requestId: string
        gameId: string
        observedAt: string
        identifiers: ClientIdentifierString[]
      }>({
        requestId: Joi.string().uuid().lowercase().required(),
        gameId: Joi.string().uuid().lowercase().required(),
        observedAt: Joi.string().isoDate().required(),
        identifiers: Joi.array()
          .items(
            Joi.array()
              .length(2)
              .ordered(
                Joi.number().valid(1, 2, 3, 4, 5, 6, 8, 9).required(),
                Joi.string()
                  .pattern(/^[0-9a-f]{64}$/)
                  .required(),
              ),
          )
          .min(1)
          .max(8)
          .unique(
            (left: ClientIdentifierString, right: ClientIdentifierString) => left[0] === right[0],
          )
          .required(),
      }).required(),
    })
    try {
      await this.identifierReconciliation.observe({
        requestId: body.requestId,
        userId: params.userId,
        gameId: body.gameId,
        observedAt: new Date(body.observedAt),
        identifiers: body.identifiers,
      })
      return { requestId: body.requestId }
    } catch (err) {
      if (err instanceof IdentifierObservationConflict) throw new httpErrors.Conflict(err.message)
      throw err
    }
  }

  @httpPost('/:userId/ban')
  async ban(ctx: RouterContext): Promise<{ requestId: string; banId: string }> {
    this.authorize(ctx)
    if (!ctx.is('application/json')) throw new httpErrors.UnsupportedMediaType()
    await bodyParser(ctx, async () => {})
    const { params, body } = validateRequest(ctx, {
      params: Joi.object<{ userId: SbUserId }>({
        userId: Joi.number().integer().min(1).max(2147483647).required(),
      }),
      body: Joi.object<{ requestId: string; endTime: string; reason: string; gameId?: string }>({
        requestId: Joi.string().uuid().lowercase().required(),
        endTime: Joi.string().isoDate().required(),
        reason: Joi.string().min(1).max(1000).required(),
        gameId: Joi.string().uuid().lowercase(),
      }).required(),
    })
    try {
      const banId = await this.banEnacter.enactBanRequest({
        requestId: body.requestId,
        targetId: params.userId,
        endTime: new Date(body.endTime),
        reason: body.reason,
        gameId: body.gameId ?? null,
      })
      return { requestId: body.requestId, banId }
    } catch (err) {
      if (err instanceof BanRequestConflict) throw new httpErrors.Conflict(err.message)
      throw err
    }
  }
}
