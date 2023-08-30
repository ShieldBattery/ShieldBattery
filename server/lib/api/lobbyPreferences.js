import httpErrors from 'http-errors'
import { isValidLobbyName } from '../../../common/constants'
import { isValidGameSubType, isValidGameType } from '../../../common/games/configuration'
import { ALL_TURN_RATES, TURN_RATE_DYNAMIC } from '../../../common/network'
import { getLobbyPreferences, upsertLobbyPreferences } from '../lobbies/lobby-preferences-models'
import { getMapInfo } from '../maps/map-models'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'

const throttle = createThrottle('lobbypreferences', {
  rate: 20,
  burst: 40,
  window: 60000,
})

export default function (router) {
  router
    .post(
      '/',
      throttleMiddleware(throttle, ctx => ctx.session.userId),
      ensureLoggedIn,
      upsertPreferences,
    )
    .get(
      '/',
      throttleMiddleware(throttle, ctx => ctx.session.userId),
      ensureLoggedIn,
      getPreferences,
    )
}

async function upsertPreferences(ctx, next) {
  const { name, gameType, gameSubType, recentMaps, selectedMap, turnRate, useLegacyLimits } =
    ctx.request.body

  if (name && !isValidLobbyName(name)) {
    throw new httpErrors.BadRequest('invalid lobby name')
  } else if (gameType && !isValidGameType(gameType)) {
    throw new httpErrors.BadRequest('invalid game type')
  } else if (gameSubType && !isValidGameSubType(gameSubType)) {
    throw new httpErrors.BadRequest('invalid game sub type')
  } else if (recentMaps && !Array.isArray(recentMaps)) {
    throw new httpErrors.BadRequest('recentMaps must be an array')
  } else if (selectedMap && !recentMaps.includes(selectedMap)) {
    throw new httpErrors.BadRequest('invalid selected map')
  } else if (turnRate && turnRate !== TURN_RATE_DYNAMIC && !ALL_TURN_RATES.includes(turnRate)) {
    throw new httpErrors.BadRequest('invalid turn rate')
  } else if (useLegacyLimits && typeof useLegacyLimits !== 'boolean') {
    throw new httpErrors.BadRequest('invalid use legacy limits')
  }

  const preferences = await upsertLobbyPreferences(ctx.session.userId, {
    name,
    gameType,
    gameSubType,
    recentMaps: recentMaps.slice(0, 5),
    selectedMap,
    turnRate,
    useLegacyLimits,
  })
  ctx.body = {
    ...preferences,
    recentMaps: await getMapInfo(preferences.recentMaps, ctx.session.userId),
  }
}

async function getPreferences(ctx, next) {
  const preferences = await getLobbyPreferences(ctx.session.userId)

  if (!preferences) {
    throw new httpErrors.NotFound('no lobby preferences found for this user')
  }

  const { selectedMap } = preferences
  const recentMaps = await getMapInfo(preferences.recentMaps, ctx.session.userId)
  ctx.body = {
    ...preferences,
    recentMaps,
    selectedMap: recentMaps.map(m => m.id).includes(selectedMap) ? selectedMap : null,
  }
}
