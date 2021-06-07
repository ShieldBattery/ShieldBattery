import errors from 'http-errors'
import { Map } from 'immutable'
import { NextFunc, NydusServer } from 'nydus'
import { container, singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { isValidUsername } from '../../../common/constants'
import users from '../models/users'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/websocket-middleware'
import { Api, Mount, registerApiRoutes } from '../websockets/api-decorators'
import { UserSocketsManager } from '../websockets/socket-groups'
import validateBody from '../websockets/validate-body'
import WhisperService, {
  WhisperServiceError,
  WhisperServiceErrorCode,
} from '../whispers/whisper-service'

const nonEmptyString = (str: unknown) => typeof str === 'string' && str.length > 0
const limit = (val: unknown) =>
  typeof val === 'undefined' || (typeof val === 'number' && val > 0 && val < 100)
const beforeTime = (val: unknown) =>
  typeof val === 'undefined' || (typeof val === 'number' && val >= -1)

const MOUNT_BASE = '/whispers'

const startThrottle = createThrottle('whisperstart', {
  rate: 3,
  burst: 10,
  window: 60000,
})
const retrievalThrottle = createThrottle('whisperretrieval', {
  rate: 30,
  burst: 120,
  window: 60000,
})
const sendThrottle = createThrottle('whispersend', {
  rate: 30,
  burst: 90,
  window: 60000,
})

function isWhisperServiceError(error: Error): error is WhisperServiceError {
  return error.hasOwnProperty('code')
}

function convertWhisperServiceError(err: Error) {
  if (!isWhisperServiceError(err)) {
    throw err
  }

  switch (err.code) {
    case WhisperServiceErrorCode.UserOffline:
      throw new errors.NotFound(err.message)
    case WhisperServiceErrorCode.InvalidCloseAction:
    case WhisperServiceErrorCode.InvalidGetSessionHistoryAction:
      throw new errors.BadRequest(err.message)
    case WhisperServiceErrorCode.NoSelfMessaging:
      throw new errors.Forbidden(err.message)
    default:
      assertUnreachable(err.code)
  }
}

@singleton()
@Mount(MOUNT_BASE)
export class WhispersApi {
  private whisperService = container.resolve(WhisperService)

  constructor(private userSockets: UserSocketsManager) {}

  @Api(
    '/start',
    validateBody({
      target: isValidUsername,
    }),
    'getUser',
    throttleMiddleware(startThrottle, (data: Map<string, any>) => data.get('user')),
    'getTarget',
  )
  async start(data: Map<string, any>) {
    const user = data.get('user')
    const target = data.get('target')

    try {
      this.whisperService.startWhisperSession(user, target)
    } catch (err) {
      convertWhisperServiceError(err)
    }
  }

  @Api(
    '/close',
    validateBody({
      target: isValidUsername,
    }),
    'getUser',
    'getTarget',
  )
  async close(data: Map<string, any>) {
    const user = data.get('user')
    const target = data.get('target')

    try {
      this.whisperService.closeWhisperSession(user, target)
    } catch (err) {
      convertWhisperServiceError(err)
    }
  }

  @Api(
    '/send',
    validateBody({
      target: isValidUsername,
      message: nonEmptyString,
    }),
    'getUser',
    throttleMiddleware(sendThrottle, (data: Map<string, any>) => data.get('user')),
    'getTarget',
  )
  async send(data: Map<string, any>) {
    const { message } = data.get('body')
    const user = data.get('user')
    const target = data.get('target')

    try {
      this.whisperService.sendWhisperMessage(user, target, message)
    } catch (err) {
      convertWhisperServiceError(err)
    }
  }

  @Api(
    '/getHistory',
    validateBody({
      target: isValidUsername,
      limit,
      beforeTime,
    }),
    'getUser',
    throttleMiddleware(retrievalThrottle, (data: Map<string, any>) => data.get('user')),
    'getTarget',
  )
  async getHistory(data: Map<string, any>) {
    const { limit, beforeTime } = data.get('body')
    const user = data.get('user')
    const target = data.get('target')

    try {
      return this.whisperService.getSessionHistory(user, target, limit, beforeTime)
    } catch (err) {
      throw convertWhisperServiceError(err)
    }
  }

  async getUser(data: Map<string, any>, next: NextFunc) {
    const user = this.userSockets.getBySocket(data.get('client'))
    if (!user) throw new errors.Unauthorized('authorization required')
    const newData = data.set('user', user)

    return next(newData)
  }

  async getTarget(data: Map<string, any>, next: NextFunc) {
    const { target } = data.get('body')
    const foundUser = await users.find(target)
    if (!foundUser) {
      throw new errors.NotFound('target user not found')
    }

    const newData = data.set('target', foundUser)
    return next(newData)
  }
}

export default function registerApi(nydus: NydusServer) {
  const api = container.resolve(WhispersApi)
  registerApiRoutes(api, nydus)
  return api
}
