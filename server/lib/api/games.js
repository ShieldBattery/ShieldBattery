import httpErrors from 'http-errors'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'

import gameCoordinator from '../games/game-coordinator'

const throttle = createThrottle('games', {
  rate: 20,
  burst: 40,
  window: 60000,
})

export default function (router) {
  router
    .put(
      '/:gameId',
      throttleMiddleware(throttle, ctx => ctx.session.userId),
      ensureLoggedIn,
      gameLoaded,
    )
    .delete(
      '/:gameId',
      throttleMiddleware(throttle, ctx => ctx.session.userId),
      ensureLoggedIn,
      loadFailed,
    )
}

async function gameLoaded(ctx, next) {
  const { gameId } = ctx.params

  if (!gameCoordinator.isLoading(gameId)) {
    throw new httpErrors.Conflict('game must be loading')
  }

  gameCoordinator.registerGame(gameId, ctx.session.userName)

  ctx.status = 204
}

async function loadFailed(ctx, next) {
  const { gameId } = ctx.params

  if (!gameCoordinator.isLoading(gameId)) {
    throw new httpErrors.Conflict('game must be loading')
  }

  gameCoordinator.maybeCancelLoading(ctx.params.gameId)

  ctx.status = 204
}
