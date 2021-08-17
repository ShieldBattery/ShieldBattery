import Router from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { singleton } from 'tsyringe'
import { toMapInfoJson } from '../../../common/maps'
import {
  ALL_MATCHMAKING_TYPES,
  GetPreferencesPayload,
  MatchmakingPreferences,
  MatchmakingPreferencesData1v1,
  MatchmakingType,
} from '../../../common/matchmaking'
import { httpApi, HttpApi } from '../http/http-api'
import { apiEndpoint } from '../http/http-api-endpoint'
import { getMapInfo } from '../maps/map-models'
import { getCurrentMapPool } from '../models/matchmaking-map-pools'
import ensureLoggedIn from '../session/ensure-logged-in'
import MatchmakingPreferencesService from './matchmaking-preferences-service'

@httpApi('/matchmakingPreferences')
@singleton()
export class MatchmakingPreferencesApi implements HttpApi {
  constructor(private matchmakingPreferencesService: MatchmakingPreferencesService) {}

  applyRoutes(router: Router): void {
    router.use(ensureLoggedIn).post('/:matchmakingType', this.upsertPreferences)
  }

  upsertPreferences = apiEndpoint(
    {
      params: Joi.object({
        matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
      }).required(),
      body: Joi.object<MatchmakingPreferences>({
        race: Joi.string().valid('p', 't', 'z', 'r').required(),
        // TODO(2Pac): min/max values most likely depend on the matchmaking type here
        mapSelections: Joi.array().items(Joi.string()).min(0).max(2).required(),
        data: Joi.alternatives()
          .try(
            Joi.object<MatchmakingPreferencesData1v1>({
              useAlternateRace: Joi.bool(),
              alternateRace: Joi.string().valid('p', 't', 'z'),
            }),
          )
          .required(),
        // NOTE(tec27): The stuff below just makes it easier to submit, these values shouldn't be
        // used and should instead come from the URL/DB/session
        userId: Joi.number().min(1).required(),
        matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
        mapPoolId: Joi.number().min(1).required(),
      }).required(),
    },
    async (ctx, { params, body }): Promise<GetPreferencesPayload> => {
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
        mapInfos,
      }
    },
  )
}
