import httpErrors from 'http-errors'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'

import gameLoader from '../games/game-loader'
import { GAME_STATUS_PLAYING, GAME_STATUS_ERROR } from '../../../common/game-status'

const throttle = createThrottle('games', {
  rate: 20,
  burst: 40,
  window: 60000,
})

export default function (router) {
  router.put(
    '/:gameId',
    throttleMiddleware(throttle, ctx => ctx.session.userId),
    ensureLoggedIn,
    updateGameStatus,
  )
}

async function updateGameStatus(ctx, next) {
  const { gameId } = ctx.params
  const { status } = ctx.request.body

  if (status < GAME_STATUS_PLAYING || status > GAME_STATUS_ERROR) {
    throw new httpErrors.BadRequest('invalid game status')
  }

  if (
    (status === GAME_STATUS_PLAYING || status === GAME_STATUS_ERROR) &&
    !gameLoader.isLoading(gameId)
  ) {
    throw new httpErrors.Conflict('game must be loading')
  }

  switch (status) {
    case GAME_STATUS_PLAYING:
      gameLoader.registerGameAsLoaded(gameId, ctx.session.userName)
      break
    case GAME_STATUS_ERROR:
      gameLoader.maybeCancelLoading(gameId)
      break
    default:
      throw new httpErrors.BadRequest('invalid game status')
  }

  ctx.status = 204
}
