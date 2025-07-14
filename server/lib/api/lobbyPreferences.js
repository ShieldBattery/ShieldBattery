import httpErrors from 'http-errors'
import { isValidLobbyName } from '../../../common/constants'
import { isValidGameSubType, isValidGameType } from '../../../common/games/game-type'
import { ALL_TURN_RATES, TURN_RATE_DYNAMIC } from '../../../common/network'
import { getLobbyPreferences, upsertLobbyPreferences } from '../lobbies/lobby-preferences-models'
import { getMapInfos } from '../maps/map-models'
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
      ensureLoggedIn,
      throttleMiddleware(throttle, ctx => ctx.session.user.id),
      upsertPreferences,
    )
    .get(
      '/',
      ensureLoggedIn,
      throttleMiddleware(throttle, ctx => ctx.session.user.id),
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

  const preferences = await upsertLobbyPreferences(ctx.session.user.id, {
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
    recentMaps: await getMapInfos(preferences.recentMaps),
  }
}

async function getPreferences(ctx, next) {
  const preferences = await getLobbyPreferences(ctx.session.user.id)

  if (!preferences) {
    throw new httpErrors.NotFound('no lobby preferences found for this user')
  }

  const { selectedMap } = preferences
  const recentMaps = await getMapInfos(preferences.recentMaps)
  ctx.body = {
    ...preferences,
    recentMaps,
    selectedMap: recentMaps.map(m => m.id).includes(selectedMap) ? selectedMap : null,
  }
}
