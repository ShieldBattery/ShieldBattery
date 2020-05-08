import httpErrors from 'http-errors'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import users from '../models/users'
import { isValidUsername } from '../../../app/common/constants'

const throttle = createThrottle('usernameavailability', {
  rate: 10,
  burst: 300,
  window: 60000,
})

export default function (router) {
  router.get(
    '/:username',
    throttleMiddleware(throttle, ctx => ctx.ip),
    checkAvailability,
  )
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
