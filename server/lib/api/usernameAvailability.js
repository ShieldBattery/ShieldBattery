import httpErrors from 'http-errors'
import users from '../models/users'
import { isValidUsername } from '../../../app/common/constants'

export default function(router) {
  router
    .get('/:username', checkAvailability)
}

async function checkAvailability(ctx, next) {
  const username = ctx.params.username
  if (!isValidUsername(username)) {
    throw new httpErrors.BadRequest('Invalid username')
  }

  let user
  try {
    user = await users.find(username)
  } catch (err) {
    ctx.log.error({ err }, 'error finding user')
    throw err
  }

  if (user) {
    throw new httpErrors.NotFound('Username not available')
  } else {
    ctx.body = { username, available: true }
  }
}
