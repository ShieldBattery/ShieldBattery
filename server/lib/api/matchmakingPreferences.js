import httpErrors from 'http-errors'
import ensureLoggedIn from '../session/ensure-logged-in'
import { isValidMatchmakingType, validRace } from '../../../common/constants'
import { MATCHMAKING } from '../../../common/flags'
import { featureEnabled } from '../flags/feature-enabled'
import { getCurrentMapPool } from '../models/matchmaking-map-pools'
import {
  getMatchmakingPreferences,
  upsertMatchmakingPreferences,
} from '../models/matchmaking-preferences'
import { getMapInfo } from '../models/maps'

export default function (router, userSockets) {
  router
    .post('/', featureEnabled(MATCHMAKING), ensureLoggedIn, upsertPreferences)
    .get('/', featureEnabled(MATCHMAKING), ensureLoggedIn, getPreferences)
}

const isValidAlternateRace = race => ['z', 't', 'p'].includes(race)

async function upsertPreferences(ctx, next) {
  const { matchmakingType, race, useAlternateRace, alternateRace, preferredMaps } = ctx.request.body

  if (!isValidMatchmakingType(matchmakingType)) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  } else if (!validRace(race)) {
    throw new httpErrors.BadRequest('invalid race')
  } else if (alternateRace && !isValidAlternateRace(alternateRace)) {
    throw new httpErrors.BadRequest('invalid alternateRace')
  } else if (preferredMaps && !Array.isArray(preferredMaps)) {
    throw new httpErrors.BadRequest('preferredMaps must be an array')
  }

  const currentMapPool = await getCurrentMapPool(matchmakingType)
  if (!currentMapPool) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  }

  const preferences = await upsertMatchmakingPreferences(
    ctx.session.userId,
    matchmakingType,
    race,
    useAlternateRace,
    alternateRace,
    currentMapPool.id,
    preferredMaps,
  )

  ctx.body = {
    ...preferences,
    preferredMaps: await getMapInfo(preferences.preferredMaps, ctx.session.userId),
  }
}

async function getPreferences(ctx, next) {
  const { matchmakingType } = ctx.query

  if (matchmakingType && !isValidMatchmakingType(matchmakingType)) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  }

  const preferences = await getMatchmakingPreferences(ctx.session.userId, matchmakingType)
  if (!preferences) {
    throw new httpErrors.NotFound('no matchmaking preferences for this user')
  }

  const currentMapPool = await getCurrentMapPool(preferences.matchmakingType)
  if (!currentMapPool) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  }

  const mapPoolOutdated = preferences.mapPoolId !== currentMapPool.id
  const preferredMaps = preferences.preferredMaps.filter(m => currentMapPool.maps.includes(m))

  ctx.body = {
    ...preferences,
    mapPoolOutdated,
    preferredMaps: await getMapInfo(preferredMaps, ctx.session.userId),
  }
}
