import whisperHandler from '../commands/whisper'

export default function parseMessage(msg) {
  if (msg[0] === '/') {
    const cmdEnd = msg.indexOf(' ') !== -1 ? msg.indexOf(' ') : msg.length
    const cmd = msg.slice(1, cmdEnd)
    const args = cmdEnd !== msg.length ? msg.slice(cmdEnd + 1, msg.length) : null

    // TODO(2Pac): Figure out a way to choose appropriate handler based on the command given
    const handler = whisperHandler[cmd] ? whisperHandler[cmd] : null
    if (!handler) {
      // TODO(2Pac): Return the list of available commands?
      return { isCommand: true, payload: { error: 'Unknown command' } }
    }
    return { isCommand: true, payload: handler(args) }
  } else {
    return { isCommand: false, payload: null }
  }
}
