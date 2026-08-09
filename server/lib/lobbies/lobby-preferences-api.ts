import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { LOBBY_NAME_MAXLENGTH } from '../../../common/constants'
import { ALL_GAME_TYPES } from '../../../common/games/game-type'
import { ALL_LOBBY_VISIBILITIES, NUM_RECENT_MAPS } from '../../../common/lobbies'
import {
  LobbyPreferencesResponse,
  UpdateLobbyPreferencesRequest,
} from '../../../common/lobbies/lobby-network'
import { toMapInfoJson } from '../../../common/maps'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpGet, httpPost } from '../http/route-decorators'
import { getMapInfos } from '../maps/map-models'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUser } from '../throttle/middleware'
import { validateRequest } from '../validation/joi-validator'
import { getLobbyPreferences, upsertLobbyPreferences } from './lobby-preferences-models'

const throttle = createThrottle('lobbypreferences', {
  rate: 20,
  burst: 40,
  window: 60000,
})

const updateLobbyPreferencesSchema = Joi.object<UpdateLobbyPreferencesRequest>({
  // The create form autosaves while being edited, so the name arrives empty whenever the user
  // has cleared (or not yet filled) the field.
  name: Joi.string().allow('').max(LOBBY_NAME_MAXLENGTH),
  gameType: Joi.valid(...ALL_GAME_TYPES),
  // gameSubType is only meaningful for team-based game types; melee/ffa saves persist whatever
  // default the client's preferences state happens to hold (0), so 0 has to validate alongside
  // the real 1-7 sub type range.
  gameSubType: Joi.number().integer().min(0).max(7),
  recentMaps: Joi.array().items(Joi.string().uuid()).max(NUM_RECENT_MAPS).required(),
  // The GET response nulls out a selected map that's no longer among the recent maps, and the
  // create form saves that value back as-is, so null has to round-trip.
  selectedMap: Joi.string().uuid().allow(null),
  useLegacyLimits: Joi.boolean(),
  visibility: Joi.valid(...ALL_LOBBY_VISIBILITIES),
  allowObservers: Joi.boolean(),
}).required()

@httpApi('/lobby-preferences')
@httpBeforeAll(ensureLoggedIn, throttleMiddleware(throttle, throttleByUser))
export class LobbyPreferencesApi {
  @httpPost('/')
  async upsertPreferences(ctx: RouterContext): Promise<LobbyPreferencesResponse> {
    const { body } = validateRequest(ctx, {
      body: updateLobbyPreferencesSchema,
    })

    const recentMaps = body.recentMaps.slice(0, NUM_RECENT_MAPS)
    if (body.selectedMap && !recentMaps.includes(body.selectedMap)) {
      throw new httpErrors.BadRequest('invalid selected map')
    }

    const preferences = await upsertLobbyPreferences(ctx.session!.user.id, {
      ...body,
      selectedMap: body.selectedMap ?? undefined,
      recentMaps,
    })
    const recentMapInfos = await getMapInfos(preferences.recentMaps ?? [])
    const recentMapIds = recentMapInfos.map(m => m.id)
    const { selectedMap } = preferences

    return {
      ...preferences,
      recentMaps: recentMapInfos.map(m => toMapInfoJson(m)),
      selectedMap:
        selectedMap !== undefined && recentMapIds.includes(selectedMap) ? selectedMap : null,
    }
  }

  @httpGet('/')
  async getPreferences(ctx: RouterContext): Promise<LobbyPreferencesResponse> {
    const preferences = await getLobbyPreferences(ctx.session!.user.id)
    if (!preferences) {
      throw new httpErrors.NotFound('no lobby preferences found for this user')
    }

    const { selectedMap } = preferences
    const recentMapInfos = await getMapInfos(preferences.recentMaps ?? [])
    const recentMapIds = recentMapInfos.map(m => m.id)

    return {
      ...preferences,
      recentMaps: recentMapInfos.map(m => toMapInfoJson(m)),
      selectedMap:
        selectedMap !== undefined && recentMapIds.includes(selectedMap) ? selectedMap : null,
    }
  }
}
