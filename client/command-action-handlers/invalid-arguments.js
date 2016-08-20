import {
  CHAT_COMMAND_INVALID_ARGS,
  LOBBY_COMMAND_INVALID_ARGS,
  WHISPER_COMMAND_INVALID_ARGS,
} from '../actions'

const invalidArguments = {
  invalidArguments: handler,
}

function handler(sourceType, source, payload, dispatch) {
  const reduxPayload = { sourceType, source, ...payload }
  switch (sourceType) {
    case 'chat':
      dispatch({ type: CHAT_COMMAND_INVALID_ARGS, payload: reduxPayload })
      break
    case 'lobby':
      dispatch({ type: LOBBY_COMMAND_INVALID_ARGS, payload: reduxPayload })
      break
    case 'whisper':
      dispatch({ type: WHISPER_COMMAND_INVALID_ARGS, payload: reduxPayload })
      break
    default:
      throw new Error('Unknown source type: ' + sourceType)
  }
}

export default invalidArguments
