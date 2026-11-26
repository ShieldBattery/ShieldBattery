import { RouterContext } from '@koa/router'
import { GetRememberedBestOfOverlayResponse } from '../../../common/lobbies/lobby-network'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpGet } from '../http/route-decorators'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUser } from '../throttle/middleware'
import { LobbyBestOfOverlayService } from './lobby-best-of-overlay-service'

const throttle = createThrottle('lobbybestofoverlay', {
  rate: 20,
  burst: 40,
  window: 60000,
})

/** The caster overlay a host's next best-of series starts with, read when the series page opens. */
@httpApi('/lobby-best-of-overlay')
@httpBeforeAll(ensureLoggedIn, throttleMiddleware(throttle, throttleByUser))
export class LobbyBestOfOverlayApi {
  constructor(private overlayService: LobbyBestOfOverlayService) {}

  @httpGet('/')
  async getRemembered(ctx: RouterContext): Promise<GetRememberedBestOfOverlayResponse> {
    return await this.overlayService.getRemembered(ctx.session!.user.id)
  }
}
