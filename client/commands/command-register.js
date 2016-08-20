import unknownCommand from '../command-action-handlers/unknown-command'
import invalidArguments from '../command-action-handlers/invalid-arguments'
import { whisper, whisperActions } from './whisper'
const commands = [
  whisper,
]
// Maps each command alias to the command descriptor object
export const aliasCommandMap = new Map()

for (const command of commands) {
  for (const alias of command.aliases) {
    if (aliasCommandMap.has(alias)) {
      throw new Error('Two commands can\'t have same alias')
    }
    aliasCommandMap.set(alias, command)
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
export const actionHandlersMap = new Map()

for (const actions of actionTypes) {
  for (const action of Object.keys(actions)) {
    actionHandlersMap.set(action, actions[action])
  }
}
