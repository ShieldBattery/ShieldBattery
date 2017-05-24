import httpErrors from 'http-errors'
import ensureLoggedIn from '../session/ensure-logged-in'
import {
  getMatchmakingPreferences,
  upsertMatchmakingPreferences
} from '../models/matchmaking-preferences'

export default function(router, userSockets) {
  router
    .post('/:matchmakingType', ensureLoggedIn, upsertPreferences)
    .get('/:matchmakingType', ensureLoggedIn, getPreferences)
}

// TODO(2Pac): Change this once matchmaking map pool support is added
const isValidMapPoolId = mapPoolId => mapPoolId === -1
const isValidAlternateRace = race => ['zerg', 'terran', 'protoss'].includes(race)

async function upsertPreferences(ctx, next) {
  const { matchmakingType } = ctx.params
  const { race, alternateRace, mapPoolId, preferredMaps } = ctx.request.body

  if (!race) {
    throw new httpErrors.BadRequest('race must be specified')
  } else if (!isValidMapPoolId(mapPoolId)) {
    throw new httpErrors.BadRequest('mapPoolId must be specified')
  } else if (alternateRace !== null && alternateRace !== undefined &&
      !isValidAlternateRace(alternateRace)) {
    throw new httpErrors.BadRequest('invalid alternateRace')
  } else if (preferredMaps !== undefined && preferredMaps !== null) {
    // TODO(2Pac): Change this once matchmaking map pool support is added
    throw new httpErrors.BadRequest('preferredMaps support not implemented yet')
  }

  ctx.body = await upsertMatchmakingPreferences(ctx.session.id, matchmakingType, race,
      alternateRace, mapPoolId, preferredMaps)
}

async function getPreferences(ctx, next) {
  const { matchmakingType } = ctx.params
  ctx.body = await getMatchmakingPreferences(ctx.session.id, matchmakingType)
}
