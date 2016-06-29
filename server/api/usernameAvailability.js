import httpErrors from 'http-errors'
import users from '../models/users'
import { isValidUsername } from '../../shared/constants'

export default function(router) {
  router
    .get('/:username', checkAvailability)
}

function* checkAvailability(next) {
  const username = this.params.username
  if (!isValidUsername(username)) {
    throw new httpErrors.BadRequest('Invalid username')
  }

  let user
  try {
    user = yield users.find(username)
  } catch (err) {
    this.log.error({ err }, 'error finding user')
    throw err
  }

  if (user) {
    throw new httpErrors.NotFound('Username not available')
  } else {
    this.body = { username, available: true }
  }
}
