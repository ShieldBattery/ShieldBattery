import httpErrors from 'http-errors'
import ensureLoggedIn from '../session/ensure-logged-in'
import { isValidMatchmakingType } from '../../../app/common/constants'
import {
  getMatchmakingPreferences,
  upsertMatchmakingPreferences
} from '../models/matchmaking-preferences'

export default function(router, userSockets) {
  router
    .post('/:matchmakingType', ensureLoggedIn, upsertPreferences)
    .get('/:matchmakingType', ensureLoggedIn, getPreferences)
}

const isValidRace = race => ['zerg', 'terran', 'protoss', 'random'].includes(race)
const isValidAlternateRace = race => ['zerg', 'terran', 'protoss'].includes(race)
// TODO(2Pac): Change this once matchmaking map pool support is added
const isValidMapPoolId = async mapPoolId => mapPoolId === -1

async function upsertPreferences(ctx, next) {
  const { matchmakingType } = ctx.params
  const { race, alternateRace, mapPoolId, preferredMaps } = ctx.request.body

  if (!isValidMatchmakingType(matchmakingType)) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  } else if (!isValidRace(race)) {
    throw new httpErrors.BadRequest('invalid race')
  } else if (!await isValidMapPoolId(mapPoolId)) {
    throw new httpErrors.NotImplemented('map pool support not implemented yet')
  } else if (alternateRace !== null && alternateRace !== undefined &&
      !isValidAlternateRace(alternateRace)) {
    throw new httpErrors.BadRequest('invalid alternateRace')
  } else if (preferredMaps !== undefined && preferredMaps !== null) {
    // TODO(2Pac): Change this once matchmaking map pool support is added
    throw new httpErrors.NotImplemented('preferredMaps support not implemented yet')
  }

  ctx.body = await upsertMatchmakingPreferences(ctx.session.userId, matchmakingType, race,
      alternateRace, mapPoolId, preferredMaps)
}

async function getPreferences(ctx, next) {
  const { matchmakingType } = ctx.params
  if (!isValidMatchmakingType(matchmakingType)) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  }

  const preferences = await getMatchmakingPreferences(ctx.session.userId, matchmakingType)
  if (!preferences) {
    throw new httpErrors.NotFound('no matchmaking preferences for this user')
  }
  ctx.body = preferences
}
