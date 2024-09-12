import httpErrors from 'http-errors'
import { ALL_MAP_SORT_TYPES, ALL_MAP_VISIBILITIES } from '../../../common/maps.js'
import { getMapPreferences, upsertMapPreferences } from '../models/map-preferences.js'
import ensureLoggedIn from '../session/ensure-logged-in.js'
import createThrottle from '../throttle/create-throttle.js'
import throttleMiddleware from '../throttle/middleware.js'

const throttle = createThrottle('mappreferences', {
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
  const { visibility, thumbnailSize, sortOption, numPlayers, tileset } = ctx.request.body

  if (!ALL_MAP_VISIBILITIES.includes(visibility)) {
    throw new httpErrors.BadRequest('Invalid map visibility: ' + visibility)
  }

  if (isNaN(thumbnailSize) || thumbnailSize < 0 || thumbnailSize > 2) {
    throw new httpErrors.BadRequest('Invalid thumbnail size: ' + thumbnailSize)
  }

  if (!ALL_MAP_SORT_TYPES.includes(sortOption)) {
    throw new httpErrors.BadRequest('Invalid sort order option: ' + sortOption)
  }

  if (!Array.isArray(numPlayers) || numPlayers.some(n => n < 2 || n > 8)) {
    throw new httpErrors.BadRequest('Invalid filter for number of players: ' + numPlayers)
  }

  if (!Array.isArray(tileset) || tileset.some(n => n < 0 || n > 7)) {
    throw new httpErrors.BadRequest('Invalid filter for tileset: ' + tileset)
  }

  ctx.body = await upsertMapPreferences(
    ctx.session.user.id,
    visibility,
    thumbnailSize,
    sortOption,
    numPlayers,
    tileset,
  )
}

async function getPreferences(ctx, next) {
  const preferences = await getMapPreferences(ctx.session.user.id)

  if (!preferences) {
    throw new httpErrors.NotFound('No map preferences found for this user')
  }

  ctx.body = preferences
}
