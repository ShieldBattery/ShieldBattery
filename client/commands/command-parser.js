import { UNKNOWN_COMMAND } from './action-types'

export default function parseCommand(commands, msg) {
  if (msg[0] !== '/') {
    // It's not a command
    return null
  }

  // Extract the command string from the message; check if the command has a space after it or not
  const cmd = msg.slice(1, msg.indexOf(' ') !== -1 ? msg.indexOf(' ') : msg.length)
  // Extract the rest of the string after command and remove any whitespace from the beginning of it
  const str = msg.slice(cmd.length + 1).trimLeft()

  if (!commands.has(cmd)) {
    return {
      type: UNKNOWN_COMMAND,
      payload: {
        commandName: cmd,
        errorText: 'Unknown command',
      },
    }
  }

  return commands.get(cmd).parser(str)
}
