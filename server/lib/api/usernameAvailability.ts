import Router, { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import { isValidUsername } from '../../../common/constants'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { isUsernameAvailable } from '../users/user-model'

const throttle = createThrottle('usernameavailability', {
  rate: 10,
  burst: 300,
  window: 60000,
})

export default function (router: Router) {
  router.get(
    '/:username',
    throttleMiddleware(throttle, ctx => ctx.ip),
    checkAvailability,
  )
}

async function checkAvailability(ctx: RouterContext) {
  const username = ctx.params.username
  if (!isValidUsername(username)) {
    throw new httpErrors.BadRequest('Invalid username')
  }

  const available = await isUsernameAvailable(username)

  if (!available) {
    throw new httpErrors.NotFound('Username not available')
  } else {
    ctx.body = { username, available }
  }
}
