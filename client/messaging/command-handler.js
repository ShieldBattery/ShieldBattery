import { dispatch } from '../dispatch-registry'
import { COMMANDS } from './commands'
import { isValidUsername } from '../../shared/constants'
import { sendMessage } from '../whispers/action-creators'
import {
  COMMAND_INVALID_ARGS,
  COMMAND_UNKNOWN,
} from '../actions'

const SOURCE_TYPES = [
  'chat',
  'lobby',
  'whispers',
]

function isValidArgsLength(args, cmd) {
  return args.length >= cmd.minArguments && args.length <= cmd.maxArguments
}

function invalidArgsAction(sourceType, source, command) {
  return {
    type: COMMAND_INVALID_ARGS,
    payload: {
      sourceType,
      source,
      usage: command.usage,
    }
  }
}

const handlers = {
  whisper: (sourceType, source, args, command) => {
    if (!isValidArgsLength(args, command) || !isValidUsername(args[0])) {
      return invalidArgsAction(sourceType, source, command)
    }

    return (dispatch) => {
      const [ target, ...text ] = args
      // TODO(2Pac): thread `sourceType` and `source` through the server so we can display whisper
      // message in the place it originated from
      dispatch(sendMessage(target, text.join(' ')))
    }
  }
}

// Add each command alias to our list of handlers as well as to the COMMANDS object
Object.values(COMMANDS).forEach(command => {
  command.aliases.forEach((alias, index, list) => {
    handlers[alias] = handlers[list.first()]
    COMMANDS[alias] = COMMANDS[list.first()]
  })
})

// `sourceType` and `source` arguments tell us where the command came from. `sourceType` can be one
// of the following: 'chat', 'lobby' or 'whispers'. `source` tells us a specific place where the
// command was typed in, ie. for 'chat' it's the channel name, for 'lobby' it's the lobby name and
// for 'whispers' it's the target user's name
export default function(sourceType, source, msg) {
  if (!SOURCE_TYPES.includes(sourceType)) {
    throw new Error('Invalid `sourceType` argument')
  }

  const args = msg.split(' ')
  const cmd = args.splice(0, 1)[0].toLowerCase()

  const action = handlers.hasOwnProperty(cmd) ?
      handlers[cmd](sourceType, source, args, COMMANDS[cmd]) : {
        type: COMMAND_UNKNOWN,
        payload: {
          sourceType,
          source,
        }
      }
  if (action) dispatch(action)
}
