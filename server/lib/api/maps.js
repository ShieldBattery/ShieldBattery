import httpErrors from 'http-errors'
import MAPS from '../maps/maps.json'

export default function(router) {
  router.get('/', ensureLoggedIn, list)
}

async function ensureLoggedIn(ctx, next) {
  if (!ctx.session.userId) {
    throw new httpErrors.Unauthorized()
  }

  await next()
}

async function list(ctx, next) {
  let { page, limit } = ctx.request.query
  if (!page || page < 0) {
    page = 0
  }
  if (!limit || limit < 0 || limit > 100) {
    /* TODO(tec27): move back to 20 after we add paginated map list support */
    limit = 50
  }

  const maps = MAPS.slice(page * limit, (page + 1) * limit)
  ctx.body = {
    maps,
    page,
    limit,
    total: MAPS.length,
  }
}
