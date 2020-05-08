import httpErrors from 'http-errors'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import {
  MAP_VISIBILITY_OFFICIAL,
  MAP_VISIBILITY_PRIVATE,
  MAP_VISIBILITY_PUBLIC,
} from '../../../app/common/constants'
import { SORT_BY_NAME, SORT_BY_NUM_OF_PLAYERS, SORT_BY_DATE } from '../../../app/common/maps'
import { upsertMapPreferences, getMapPreferences } from '../models/map-preferences'

const throttle = createThrottle('mappreferences', {
  rate: 20,
  burst: 40,
  window: 60000,
})

export default function (router, userSockets) {
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

const VISIBILITIES = [MAP_VISIBILITY_OFFICIAL, MAP_VISIBILITY_PRIVATE, MAP_VISIBILITY_PUBLIC]
const SORT_ORDERS = [SORT_BY_NAME, SORT_BY_NUM_OF_PLAYERS, SORT_BY_DATE]

async function upsertPreferences(ctx, next) {
  const { visibility, thumbnailSize, sortOption, numPlayers, tileset } = ctx.request.body

  if (!VISIBILITIES.includes(visibility)) {
    throw new httpErrors.BadRequest('Invalid map visibility: ' + visibility)
  }

  if (isNaN(thumbnailSize) || thumbnailSize < 0 || thumbnailSize > 2) {
    throw new httpErrors.BadRequest('Invalid thumbnail size: ' + thumbnailSize)
  }

  if (!SORT_ORDERS.includes(sortOption)) {
    throw new httpErrors.BadRequest('Invalid sort order option: ' + sortOption)
  }

  if (!Array.isArray(numPlayers) || numPlayers.some(n => n < 2 || n > 8)) {
    throw new httpErrors.BadRequest('Invalid filter for number of players: ' + numPlayers)
  }

  if (!Array.isArray(tileset) || tileset.some(n => n < 0 || n > 7)) {
    throw new httpErrors.BadRequest('Invalid filter for tileset: ' + tileset)
  }

  ctx.body = await upsertMapPreferences(
    ctx.session.userId,
    visibility,
    thumbnailSize,
    sortOption,
    numPlayers,
    tileset,
  )
}

async function getPreferences(ctx, next) {
  const preferences = await getMapPreferences(ctx.session.userId)

  if (!preferences) {
    throw new httpErrors.NotFound('No map preferences found for this user')
  }

  ctx.body = preferences
}
