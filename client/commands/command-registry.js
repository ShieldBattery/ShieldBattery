import unknownCommand from './unknown-command'
import invalidArguments from './invalid-arguments'
import { whisper, whisperActions } from './whisper'
const commands = [
  whisper,
]
// Maps each command alias to the command descriptor object
export const aliasCommands = new Map()

for (const command of commands) {
  for (const alias of command.aliases) {
    if (aliasCommands.has(alias)) {
      throw new Error('Two commands can\'t have same alias')
    }
    aliasCommands.set(alias, command)
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
export const actionHandlers = new Map()

for (const actions of actionTypes) {
  for (const action of Object.keys(actions)) {
    if (actionHandlers.has(action)) {
      throw new Error('Two handlers can\'t handle same action')
    }
    actionHandlers.set(action, actions[action])
  }
}
