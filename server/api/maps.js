import httpErrors from 'http-errors'
import MAPS from '../maps/maps.json'

export default function(router) {
  router.get('/', ensureLoggedIn, list)
}

function* ensureLoggedIn(next) {
  if (!this.session.userId) {
    throw new httpErrors.Unauthorized()
  }

  yield next
}

function* list(next) {
  let { page, limit } = this.request.query
  if (!page || page < 0) {
    page = 0
  }
  if (!limit || limit < 0 || limit > 100) {
    /* TODO(tec27): move back to 20 after we add paginated map list support */
    limit = 40
  }

  const maps = MAPS.slice(page * limit, (page + 1) * limit)
  this.body = {
    maps,
    page,
    limit,
    total: MAPS.length,
  }
}
