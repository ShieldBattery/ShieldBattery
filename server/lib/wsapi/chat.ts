import errors from 'http-errors'
import { Map } from 'immutable'
import { NextFunc, NydusServer, RouteHandler } from 'nydus'
import { container, singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { isValidChannelName } from '../../../common/constants'
import { MULTI_CHANNEL } from '../../../common/flags'
import ChatService, { ChatServiceError, ChatServiceErrorCode } from '../chat/chat-service'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/websocket-middleware'
import { Api, Mount, registerApiRoutes } from '../websockets/api-decorators'
import { UserSocketsManager } from '../websockets/socket-groups'
import validateBody from '../websockets/validate-body'

const joinThrottle = createThrottle('chatjoin', {
  rate: 3,
  burst: 10,
  window: 60000,
})
const retrievalThrottle = createThrottle('chatretrieval', {
  rate: 30,
  burst: 120,
  window: 60000,
})
const sendThrottle = createThrottle('chatsend', {
  rate: 30,
  burst: 90,
  window: 60000,
})

function isChatServiceError(error: Error): error is ChatServiceError {
  return error.hasOwnProperty('code')
}

function convertChatServiceError(err: Error) {
  if (!isChatServiceError(err)) {
    throw err
  }

  switch (err.code) {
    case ChatServiceErrorCode.UserOffline:
      throw new errors.NotFound(err.message)
    case ChatServiceErrorCode.InvalidJoinAction:
    case ChatServiceErrorCode.InvalidLeaveAction:
    case ChatServiceErrorCode.InvalidSendAction:
    case ChatServiceErrorCode.InvalidGetHistoryAction:
    case ChatServiceErrorCode.InvalidGetUsersAction:
      throw new errors.BadRequest(err.message)
    case ChatServiceErrorCode.LeaveShieldBattery:
      throw new errors.Forbidden(err.message)
    default:
      assertUnreachable(err.code)
  }
}

const featureEnabled: RouteHandler = async (data, next) => {
  if (!MULTI_CHANNEL) throw new errors.NotFound()
  return next(data)
}
const nonEmptyString = (str: unknown) => typeof str === 'string' && str.length > 0
const limit = (val: unknown) =>
  typeof val === 'undefined' || (typeof val === 'number' && val > 0 && val < 100)
const beforeTime = (val: unknown) =>
  typeof val === 'undefined' || (typeof val === 'number' && val >= -1)

const MOUNT_BASE = '/chat'

@singleton()
@Mount(MOUNT_BASE)
export class ChatApi {
  constructor(private userSockets: UserSocketsManager) {
    container.resolve(ChatService)
  }

  @Api(
    '/join',
    featureEnabled,
    validateBody({
      channel: isValidChannelName,
    }),
    'getUser',
    throttleMiddleware(joinThrottle, (data: Map<string, any>) => data.get('user')),
  )
  async join(data: Map<string, any>) {
    const user = data.get('user')
    const { channel } = data.get('body')

    try {
      const chatService = container.resolve(ChatService)
      chatService.joinChannel(channel, user.name)
    } catch (err) {
      convertChatServiceError(err)
    }
  }

  @Api(
    '/leave',
    featureEnabled,
    validateBody({
      channel: isValidChannelName,
    }),
    'getUser',
  )
  async leave(data: Map<string, any>) {
    const user = data.get('user')
    const { channel } = data.get('body')

    try {
      const chatService = container.resolve(ChatService)
      chatService.leaveChannel(channel, user.name)
    } catch (err) {
      convertChatServiceError(err)
    }
  }

  @Api(
    '/send',
    validateBody({
      channel: isValidChannelName,
      message: nonEmptyString,
    }),
    'getUser',
    throttleMiddleware(sendThrottle, (data: Map<string, any>) => data.get('user')),
  )
  async send(data: Map<string, any>) {
    const user = data.get('user')
    const { channel, message } = data.get('body')

    try {
      const chatService = container.resolve(ChatService)
      chatService.sendChatMessage(channel, user.name, message)
    } catch (err) {
      convertChatServiceError(err)
    }
  }

  @Api(
    '/getHistory',
    validateBody({
      channel: isValidChannelName,
      limit,
      beforeTime,
    }),
    'getUser',
    throttleMiddleware(retrievalThrottle, (data: Map<string, any>) => data.get('user')),
  )
  async getHistory(data: Map<string, any>) {
    const user = data.get('user')
    const { channel, limit, beforeTime } = data.get('body')

    try {
      const chatService = container.resolve(ChatService)
      return chatService.getChannelHistory(channel, user.name, limit, beforeTime)
    } catch (err) {
      return convertChatServiceError(err)
    }
  }

  @Api(
    '/getUsers',
    validateBody({
      channel: isValidChannelName,
    }),
    'getUser',
    throttleMiddleware(retrievalThrottle, (data: Map<string, any>) => data.get('user')),
  )
  async getUsers(data: Map<string, any>) {
    const user = data.get('user')
    const { channel } = data.get('body')

    try {
      const chatService = container.resolve(ChatService)
      return chatService.getChannelUsers(channel, user.name)
    } catch (err) {
      return convertChatServiceError(err)
    }
  }

  async getUser(data: Map<string, any>, next: NextFunc) {
    const user = this.userSockets.getBySocket(data.get('client'))
    if (!user) throw new errors.Unauthorized('authorization required')
    const newData = data.set('user', user)

    return next(newData)
  }
}

export default function registerApi(nydus: NydusServer) {
  const api = container.resolve(ChatApi)
  registerApiRoutes(api, nydus)
  return api
}
