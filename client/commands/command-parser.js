import { aliasCommandMap } from './command-handlers'
import { COMMAND_LOCAL_RESPONSE } from '../actions'

export default function parseCommand(msg) {
  if (msg[0] !== '/') {
    // It's not a command
    return null
  }

  // Split the first two words from the string (first being the command name and second being the
  // first word of the rest of the string)
  const msgArray = msg.split(' ', 2)
  // Remove the first character (forward slash) from the command name
  const cmd = msg.slice(1, msgArray[0].length)
  const str = msg.lastIndexOf(msgArray[1]) !== -1 ? msg.slice(msg.lastIndexOf(msgArray[1])) : ''

  if (!aliasCommandMap.has(cmd)) {
    return {
      type: COMMAND_LOCAL_RESPONSE,
      payload: {
        commandName: cmd,
        errorText: 'Unknown command',
        // TODO(2Pac): Return the list of available commands?
      },
      error: true,
    }
  }

  return aliasCommandMap.get(cmd).handler(str)
}
