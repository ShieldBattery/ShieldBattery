import { RouterContext } from '@koa/router'
import Joi from 'joi'
import { BEST_OF_MAX_SIDE_SIZE } from '../../../common/lobbies/lobby-best-of'
import {
  GetRememberedBestOfDisplayNamesResponse,
  GetRememberedBestOfOverlayResponse,
} from '../../../common/lobbies/lobby-network'
import { SbUserId } from '../../../common/users/sb-user-id'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpGet } from '../http/route-decorators'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUser } from '../throttle/middleware'
import { joiUserId } from '../users/user-validators'
import { validateRequest } from '../validation/joi-validator'
import { LobbyBestOfOverlayService } from './lobby-best-of-overlay-service'

const throttle = createThrottle('lobbybestofoverlay', {
  rate: 20,
  burst: 40,
  window: 60000,
})

/**
 * What a host's next best-of series starts with: the caster overlay, read when the series page
 * opens, and the display names the host last gave players, read when it opens and whenever the host
 * puts someone on a side.
 */
@httpApi('/lobby-best-of-overlay')
@httpBeforeAll(ensureLoggedIn, throttleMiddleware(throttle, throttleByUser))
export class LobbyBestOfOverlayApi {
  constructor(private overlayService: LobbyBestOfOverlayService) {}

  @httpGet('/')
  async getRemembered(ctx: RouterContext): Promise<GetRememberedBestOfOverlayResponse> {
    return await this.overlayService.getRemembered(ctx.session!.user.id)
  }

  /** Takes the people to look up as `u`, once per person, at most as many as both sides hold. */
  @httpGet('/display-names')
  async getRememberedDisplayNames(
    ctx: RouterContext,
  ): Promise<GetRememberedBestOfDisplayNamesResponse> {
    const { query } = validateRequest(ctx, {
      query: Joi.object<{ u: SbUserId[] }>({
        u: Joi.array()
          .items(joiUserId())
          .single()
          .unique()
          .min(1)
          .max(BEST_OF_MAX_SIDE_SIZE * 2)
          .required(),
      }).required(),
    })

    return {
      displayNames: await this.overlayService.getRememberedDisplayNames(
        ctx.session!.user.id,
        query.u,
      ),
    }
  }
}
