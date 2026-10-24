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

  constructor(private banEnacter: BanEnacter) {}

  @httpPost('/:userId/ban')
  async ban(ctx: RouterContext): Promise<{ requestId: string; banId: string }> {
    this.authorize(ctx)
    if (!ctx.is('application/json')) throw new httpErrors.UnsupportedMediaType()
    await bodyParser(ctx, async () => {})
    const { params, body } = validateRequest(ctx, {
      params: Joi.object<{ userId: SbUserId }>({
        userId: Joi.number().integer().min(1).max(2147483647).required(),
      }),
      body: Joi.object<{ requestId: string; endTime: string; reason: string }>({
        requestId: Joi.string().uuid().lowercase().required(),
        endTime: Joi.string().isoDate().required(),
        reason: Joi.string().min(1).max(1000).required(),
      }).required(),
    })
    try {
      const banId = await this.banEnacter.enactBanRequest({
        requestId: body.requestId,
        targetId: params.userId,
        endTime: new Date(body.endTime),
        reason: body.reason,
      })
      return { requestId: body.requestId, banId }
    } catch (err) {
      if (err instanceof BanRequestConflict) throw new httpErrors.Conflict(err.message)
      throw err
    }
  }
}
