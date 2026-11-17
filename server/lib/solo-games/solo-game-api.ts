import { RouterContext } from '@koa/router'
import Joi from 'joi'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { ALL_RACE_CHARS } from '../../../common/races'
import { LaunchSoloGameRequest, SoloGameServiceErrorCode } from '../../../common/solo-games'
import { makeErrorConverterMiddleware } from '../errors/coded-error'
import { asHttpError } from '../errors/error-with-payload'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpPost } from '../http/route-decorators'
import { resolveMapId } from '../maps/map-models'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUser } from '../throttle/middleware'
import { validateRequest } from '../validation/joi-validator'
import { ClientSocketsManager } from '../websockets/socket-groups'
import { SoloGameService } from './solo-game-service'
import { SoloGameServiceError } from './solo-game-service-error'

// Launching a game is a one-off transition like creating a lobby, so it gets the same rate.
const soloGameThrottle = createThrottle('solo-games', {
  rate: 20,
  burst: 40,
  window: 60000,
})

export const launchSoloGameBody = Joi.object<LaunchSoloGameRequest>({
  clientId: Joi.string().required(),
  map: Joi.string().required(),
  // BW numbers a map's player slots 0-11
  slot: Joi.number().integer().min(0).max(11),
  race: Joi.string().valid(...ALL_RACE_CHARS),
})

/**
 * Translates a failure from `SoloGameService` into an HTTP error, passing anything that isn't a
 * service error through untouched. None of them is a 401, which would log the client out.
 */
export function convertSoloGameServiceError(err: unknown): void {
  if (!(err instanceof SoloGameServiceError)) {
    throw err
  }

  switch (err.code) {
    case SoloGameServiceErrorCode.NoActiveClient:
    case SoloGameServiceErrorCode.MapNotPlayableAlone:
    case SoloGameServiceErrorCode.InvalidSlot:
    case SoloGameServiceErrorCode.InvalidRace:
      throw asHttpError(400, err)
    case SoloGameServiceErrorCode.MapNotFound:
      throw asHttpError(404, err)
    case SoloGameServiceErrorCode.AlreadyInActivity:
    case SoloGameServiceErrorCode.AlreadyInGame:
      throw asHttpError(409, err)
    default:
      return assertUnreachable(err.code)
  }
}

const convertSoloGameServiceErrors = makeErrorConverterMiddleware(convertSoloGameServiceError)

@httpApi('/solo-games')
@httpBeforeAll(convertSoloGameServiceErrors)
export class SoloGameApi {
  constructor(
    private soloGameService: SoloGameService,
    private clientSocketsManager: ClientSocketsManager,
  ) {}

  /**
   * Launches a game the user plays alone, from the app client the request names. Responds once the
   * game has begun loading; the client hears how the launch turned out over its socket.
   */
  @httpPost('/')
  @httpBefore(ensureLoggedIn, throttleMiddleware(soloGameThrottle, throttleByUser))
  async launch(ctx: RouterContext): Promise<void> {
    const { body } = validateRequest(ctx, { body: launchSoloGameBody })

    const client = this.clientSocketsManager.getById(ctx.session!.user.id, body.clientId)
    if (!client) {
      throw new SoloGameServiceError(
        SoloGameServiceErrorCode.NoActiveClient,
        'no socket connection for that client',
      )
    }
    if (client.clientType !== 'electron') {
      throw new SoloGameServiceError(SoloGameServiceErrorCode.NoActiveClient, 'not an app client')
    }

    await this.soloGameService.launch({
      client,
      mapId: await resolveMapId(body.map),
      slot: body.slot,
      race: body.race,
    })
  }
}
