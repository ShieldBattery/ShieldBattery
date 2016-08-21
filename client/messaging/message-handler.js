import parseCommand from '../commands/command-parser'
import { aliasCommands as commands, actionHandlers as handlers } from '../commands/command-registry'

export default function handleChatMessage(msg, sourceType, source, sendMessage, dispatch) {
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
