import parseCommand from '../commands/command-parser'
import { commands, handlers } from '../commands/command-registry'

export default function submitMessage(msg, sourceType, source, sendMessage) {
  return dispatch => {
    const command = parseCommand(commands, msg)
    if (command) {
      if (handlers.has(command.type)) {
        const handler = handlers.get(command.type)
        handler(sourceType, source, command.payload, dispatch)
      }
    } else {
      dispatch(sendMessage(source, msg))
    }
  }
}
