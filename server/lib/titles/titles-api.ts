import { RouterContext } from '@koa/router'
import Joi from 'joi'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { ALL_TITLE_IDS, TitleId } from '../../../common/titles'
import {
  AdminGetUserTitlesResponse,
  EquipTitleRequest,
  EquipTitleResponse,
  GetSelfTitlesResponse,
} from '../../../common/titles-network'
import { SbUserId } from '../../../common/users/sb-user-id'
import { makeErrorConverterMiddleware } from '../errors/coded-error'
import { asHttpError } from '../errors/error-with-payload'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPost } from '../http/route-decorators'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUser } from '../throttle/middleware'
import { joiUserId } from '../users/user-validators'
import { validateRequest } from '../validation/joi-validator'
import { TitleService, TitleServiceError, TitleServiceErrorCode } from './title-service'

const titlesThrottle = createThrottle('titles', {
  rate: 20,
  burst: 40,
  window: 60000,
})

const joiTitleId = () => Joi.valid(...ALL_TITLE_IDS)

const convertTitleServiceErrors = makeErrorConverterMiddleware(err => {
  if (!(err instanceof TitleServiceError)) {
    throw err
  }

  switch (err.code) {
    case TitleServiceErrorCode.NotFound:
      throw asHttpError(404, err)
    case TitleServiceErrorCode.NotUnlocked:
      throw asHttpError(403, err)
    case TitleServiceErrorCode.NotGrantable:
      throw asHttpError(400, err)
    default:
      assertUnreachable(err.code)
  }
})

@httpApi('/titles')
@httpBeforeAll(ensureLoggedIn, convertTitleServiceErrors)
export class TitlesApi {
  constructor(private titleService: TitleService) {}

  @httpGet('/me')
  @httpBefore(throttleMiddleware(titlesThrottle, throttleByUser))
  async getSelfTitles(ctx: RouterContext): Promise<GetSelfTitlesResponse> {
    return await this.titleService.getSelfTitles(ctx.session!.user.id)
  }

  @httpPost('/me/equipped')
  @httpBefore(throttleMiddleware(titlesThrottle, throttleByUser))
  async equipTitle(ctx: RouterContext): Promise<EquipTitleResponse> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<EquipTitleRequest>({
        titleId: joiTitleId().required(),
      }).required(),
    })

    const user = await this.titleService.equipTitle(ctx.session!.user.id, body.titleId, ctx)
    return { user }
  }
}

@httpApi('/admin/titles')
@httpBeforeAll(ensureLoggedIn, checkAllPermissions('editPermissions'), convertTitleServiceErrors)
export class AdminTitlesApi {
  constructor(private titleService: TitleService) {}

  @httpGet('/users/:userId')
  async getUserTitles(ctx: RouterContext): Promise<AdminGetUserTitlesResponse> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ userId: SbUserId }>({
        userId: joiUserId().required(),
      }).required(),
    })

    return { unlocked: await this.titleService.getUserTitles(params.userId) }
  }

  @httpPost('/users/:userId/:titleId')
  async grantTitle(ctx: RouterContext): Promise<AdminGetUserTitlesResponse> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ userId: SbUserId; titleId: TitleId }>({
        userId: joiUserId().required(),
        titleId: joiTitleId().required(),
      }).required(),
    })

    const unlocked = await this.titleService.grantTitle(
      params.userId,
      params.titleId,
      ctx.session!.user.id,
      ctx,
    )
    return { unlocked }
  }

  @httpDelete('/users/:userId/:titleId')
  async revokeTitle(ctx: RouterContext): Promise<AdminGetUserTitlesResponse> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ userId: SbUserId; titleId: TitleId }>({
        userId: joiUserId().required(),
        titleId: joiTitleId().required(),
      }).required(),
    })

    const unlocked = await this.titleService.revokeTitle(params.userId, params.titleId, ctx)
    return { unlocked }
  }
}
