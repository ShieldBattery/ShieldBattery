import { sendMessage } from '../whispers/action-creators'
import { INVALID_ARGUMENTS, WHISPER } from './action-types'

export const whisper = {
  aliases: ['whisper', 'w', 'message', 'msg', 'm'],
  usage: '/whisper USERNAME MESSAGE (aliases: /w /message /msg /m)',
  infoText: 'Sends a private MESSAGE to USERNAME',
  example: '/whisper Pachi How are you doing?',
  parser: whisperParser,
}

function whisperParser(str) {
  if (!str) {
    return {
      type: INVALID_ARGUMENTS,
      payload: {
        commandName: 'whisper',
        errorText: 'No username entered',
        usage: whisper.usage,
      },
    }
  }

  // Extract the target from the message; check if the target has a space after it or not
  const target = str.slice(0, str.indexOf(' ') !== -1 ? str.indexOf(' ') : str.length)
  // Extract the message after target and remove any whitespace at the end of it (preserves it at
  // the beginning)
  const message = str.slice(target.length + 1).trimRight()

  if (!message) {
    return {
      type: INVALID_ARGUMENTS,
      payload: {
        commandName: 'whisper',
        errorText: 'No message entered',
        usage: whisper.usage,
      },
    }
  }

  return {
    type: WHISPER,
    payload: {
      target,
      message,
    },
  }
}

export const whisperActions = {
  whisper: whisperHandler,
}

function whisperHandler(sourceType, source, payload, dispatch) {
  dispatch(sendMessage(payload.target, payload.message))
}
