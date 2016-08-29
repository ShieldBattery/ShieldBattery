import {
  CHAT_COMMAND_UNKNOWN,
  LOBBY_COMMAND_UNKNOWN,
  WHISPER_COMMAND_UNKNOWN,
} from '../actions'

const unknownCommand = {
  unknownCommand: handler,
}

function handler(sourceType, source, payload, dispatch) {
  const reduxPayload = { sourceType, source, ...payload }
  switch (sourceType) {
    case 'chat':
      dispatch({ type: CHAT_COMMAND_UNKNOWN, payload: reduxPayload })
      break
    case 'lobby':
      dispatch({ type: LOBBY_COMMAND_UNKNOWN, payload: reduxPayload })
      break
    case 'whisper':
      dispatch({ type: WHISPER_COMMAND_UNKNOWN, payload: reduxPayload })
      break
    default:
      throw new Error('Unknown source type: ' + sourceType)
  }
}

export default unknownCommand
