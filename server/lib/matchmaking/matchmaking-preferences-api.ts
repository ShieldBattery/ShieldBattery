import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { toMapInfoJson } from '../../../common/maps'
import {
  ALL_MATCHMAKING_TYPES,
  GetPreferencesResponse,
  MatchmakingPreferences,
  MatchmakingType,
} from '../../../common/matchmaking'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpPost } from '../http/route-decorators'
import { getMapInfo } from '../maps/map-models'
import { getCurrentMapPool } from '../models/matchmaking-map-pools'
import ensureLoggedIn from '../session/ensure-logged-in'
import { validateRequest } from '../validation/joi-validator'
import MatchmakingPreferencesService from './matchmaking-preferences-service'
import { matchmakingPreferencesValidator } from './matchmaking-validators'

@httpApi('/matchmakingPreferences')
@httpBeforeAll(ensureLoggedIn)
export class MatchmakingPreferencesApi {
  constructor(private matchmakingPreferencesService: MatchmakingPreferencesService) {}

  @httpPost('/:matchmakingType')
  async upsertPreferences(ctx: RouterContext): Promise<GetPreferencesResponse> {
    const { params, body } = validateRequest(ctx, {
      params: Joi.object<{ matchmakingType: MatchmakingType }>({
        matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
      }).required(),
      body: matchmakingPreferencesValidator(ctx.session!.userId).required(),
    })

    const currentMapPool = await getCurrentMapPool(params.matchmakingType)
    if (!currentMapPool) {
      throw new httpErrors.BadRequest('invalid matchmaking type')
    }

    if (params.matchmakingType === MatchmakingType.Match1v1) {
      const {
        race,
        data: { useAlternateRace },
      } = body
      if (race === 'r' && useAlternateRace === true) {
        throw new httpErrors.BadRequest('cannot use alternate race as random')
      }
    }

    const preferences = await this.matchmakingPreferencesService.upsertPreferences({
      userId: ctx.session!.userId,
      matchmakingType: params.matchmakingType,
      race: body.race,
      mapPoolId: currentMapPool.id,
      mapSelections: body.mapSelections,
      data: body.data,
    } as MatchmakingPreferences)

    const mapInfos = (
      await getMapInfo(preferences.mapSelections.filter(m => currentMapPool.maps.includes(m)))
    ).map(m => toMapInfoJson(m))

    return {
      preferences,
      mapPoolOutdated: false,
      currentMapPoolId: currentMapPool.id,
      mapInfos,
    }
  }
}
