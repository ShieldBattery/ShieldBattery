import httpErrors from 'http-errors'
import Router, { RouterContext } from '@koa/router'
import Joi from 'joi'

import { MATCHMAKING } from '../../../common/flags'
import {
  ALL_MATCHMAKING_TYPES,
  GetPreferencesPayload,
  MatchmakingType,
  UpdateMatchmakingPreferencesBody,
} from '../../../common/matchmaking'
import { joiValidator } from '../validation/joi-validator'
import ensureLoggedIn from '../session/ensure-logged-in'
import { featureEnabled } from '../flags/feature-enabled'
import { getCurrentMapPool } from '../models/matchmaking-map-pools'
import {
  getMatchmakingPreferences,
  upsertMatchmakingPreferences,
} from '../models/matchmaking-preferences'
import { getMapInfo } from '../models/maps'

const matchmakingTypeSchema = Joi.object({
  matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
})

interface MatchmakingTypeParams {
  matchmakingType: MatchmakingType
}

const matchmakingPreferencesSchema = Joi.object({
  race: Joi.string().valid('p', 't', 'z', 'r').required(),
  useAlternateRace: Joi.bool().required(),
  alternateRace: Joi.string().valid('p', 't', 'z').required(),
  preferredMaps: Joi.array().items(Joi.string()).min(0).max(2).required(),
  // NOTE(tec27): The stuff below just makes it easier to submit, these values shouldn't be used
  // and should instead come from the URL/DB
  matchmakingType: Joi.any(),
}).required()

export default function (router: Router) {
  router
    .use(featureEnabled(MATCHMAKING), ensureLoggedIn)
    .post(
      '/:matchmakingType',
      joiValidator({ params: matchmakingTypeSchema, body: matchmakingPreferencesSchema }),
      upsertPreferences,
    )
    .get('/:matchmakingType', joiValidator({ params: matchmakingTypeSchema }), getPreferences)
}

async function upsertPreferences(ctx: RouterContext) {
  const { matchmakingType } = ctx.params as MatchmakingTypeParams
  const { race, useAlternateRace, alternateRace, preferredMaps } = ctx.request
    .body as UpdateMatchmakingPreferencesBody

  const currentMapPool = await getCurrentMapPool(matchmakingType)
  if (!currentMapPool) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  }

  const preferences = await upsertMatchmakingPreferences(ctx.session!.userId, {
    matchmakingType,
    race,
    useAlternateRace,
    alternateRace,
    mapPoolId: currentMapPool.id,
    preferredMaps,
  })

  const result: GetPreferencesPayload = {
    preferences,
    mapPoolOutdated: false,
    mapInfo: await getMapInfo(preferences.preferredMaps),
  }

  ctx.body = result
}

async function getPreferences(ctx: RouterContext) {
  const { matchmakingType } = ctx.params as MatchmakingTypeParams

  const preferences = await getMatchmakingPreferences(ctx.session!.userId, matchmakingType)
  if (!preferences) {
    throw new httpErrors.NotFound('no matchmaking preferences for this user/matchmakingType')
  }

  const currentMapPool = await getCurrentMapPool(preferences.matchmakingType)
  if (!currentMapPool) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  }

  const mapPoolOutdated = preferences.mapPoolId !== currentMapPool.id
  const preferredMaps = preferences.preferredMaps.filter(m => currentMapPool.maps.includes(m))

  const result: GetPreferencesPayload = {
    preferences,
    mapPoolOutdated,
    mapInfo: await getMapInfo(preferredMaps),
  }
  ctx.body = result
}
