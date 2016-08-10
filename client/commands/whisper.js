import { Aliases } from './command-decorators'

const whisper = {
  aliases: ['whisper', 'w', 'message', 'msg', 'm'],
  usage: '/whisper USERNAME MESSAGE (aliases: /w /message /msg /m)',
  infoText: 'Sends a private MESSAGE to USERNAME',
  example: '/whisper Pachi How are you doing?'
}

@Aliases(whisper)
class WhisperHandler {
  whisper(args) {
    if (!args) {
      return { commandName: 'whisper', error: 'No username entered', usage: whisper.usage }
    }
    const targetEnd = args.indexOf(' ') !== -1 ? args.indexOf(' ') : args.length
    const target = args.slice(0, targetEnd)
    const text = targetEnd !== args.length ? args.slice(targetEnd + 1, args.length) : null
    if (!text) {
      return { commandName: 'whisper', error: 'No message entered', usage: whisper.usage }
    }
    return { commandName: 'whisper', target, text }
  }
}

export default new WhisperHandler()
