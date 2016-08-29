import unknownCommand from './unknown-command'
import invalidArguments from './invalid-arguments'
import { whisper, whisperActions } from './whisper'
const commandsArray = [
  whisper,
]
// Maps each command alias to the command descriptor object
export const commands = new Map()

for (const command of commandsArray) {
  for (const alias of command.aliases) {
    if (commands.has(alias)) {
      throw new Error('Two commands can\'t have same alias')
    }
    commands.set(alias, command)
  }
}

const actionTypes = [
  // Common action types that are used across all the parsers
  unknownCommand,
  invalidArguments,
  // Rest of the action types that parsers return and which are specific to a particular parser
  whisperActions,
]
// Maps each command action type (stuff that command parsers return) to a handler function
export const handlers = new Map()

for (const actions of actionTypes) {
  for (const action of Object.keys(actions)) {
    if (handlers.has(action)) {
      throw new Error('Two handlers can\'t handle same action')
    }
    handlers.set(action, actions[action])
  }
}
