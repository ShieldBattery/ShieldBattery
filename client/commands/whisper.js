import { COMMAND_LOCAL_RESPONSE } from '../actions'

const whisper = {
  aliases: ['whisper', 'w', 'message', 'msg', 'm'],
  usage: '/whisper USERNAME MESSAGE (aliases: /w /message /msg /m)',
  infoText: 'Sends a private MESSAGE to USERNAME',
  example: '/whisper Pachi How are you doing?',
  handler: whisperHandler,
}

function whisperHandler(str) {
  if (!str) {
    return {
      type: COMMAND_LOCAL_RESPONSE,
      payload: {
        commandName: 'whisper',
        errorText: 'No username entered',
        usage: whisper.usage,
      },
      error: true,
    }
  }

  // Split the first two words from the string (first being the target and second being the first
  // word of an actual message)
  const strArray = str.split(' ', 2)
  const target = strArray[0]

  if (!strArray[1]) {
    return {
      type: COMMAND_LOCAL_RESPONSE,
      payload: {
        commandName: 'whisper',
        errorText: 'No message entered',
        usage: whisper.usage,
      },
      error: true,
    }
  }
  const text = str.slice(str.lastIndexOf(strArray[1]))

  return {
    type: COMMAND_LOCAL_RESPONSE,
    payload: {
      commandName: 'whisper',
      target,
      text,
    },
  }
}

export default function registerHandler(aliasCommandMap) {
  for (const alias of whisper.aliases) {
    if (aliasCommandMap.has(alias)) {
      throw new Error('Two commands can\'t have same alias')
    }
    aliasCommandMap.set(alias, whisper)
  }
}
