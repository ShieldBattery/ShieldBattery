import { TFunction } from 'i18next'
import { getErrorStack } from '../../../common/errors'
import { ReduxAction } from '../../action-types'
import { DispatchFunction } from '../../dispatch-registry'
import logger from '../../logging/logger'
import { CommandContext } from './command-context'
import {
  argumentFailureLine,
  commandFailedLine,
  unknownCommandLine,
  wrongSurfaceLine,
} from './command-lines'
import { parseArgs, splitCommandInput } from './command-parser'
import { ALL_COMMANDS, findCommand } from './command-registry'
import { ChatCommand, getCommandUsage } from './command-schema'
import { LocalLineEmitter } from './local-output'

/** What the command layer needs from the surface an input was submitted in. */
export interface CommandRunDeps {
  context: CommandContext
  dispatch: DispatchFunction<ReduxAction>
  t: TFunction
  emit: LocalLineEmitter
}

export type CommandRunResult =
  /** The input is ordinary chat text (with any `//` escape already reduced) and should be sent. */
  | { kind: 'text'; text: string }
  /** The input was a command: it ran, or it was rejected with a local error line. Nothing is sent. */
  | { kind: 'command' }

/**
 * Runs the command a submitted input names, if it names one. Only a `/` at the very start of the
 * (trimmed) input starts a command; `//` escapes to a literal leading slash.
 */
export function runChatCommand(input: string, deps: CommandRunDeps): CommandRunResult {
  return runChatCommandWith(ALL_COMMANDS, input, deps)
}

/**
 * Runs an input against a given set of commands rather than every command there is, so that a
 * caller (such as a test) can decide exactly what exists.
 */
export function runChatCommandWith(
  commands: ReadonlyArray<ChatCommand>,
  input: string,
  deps: CommandRunDeps,
): CommandRunResult {
  const { context, dispatch, t, emit } = deps

  const split = splitCommandInput(input)
  if (split.kind === 'text') {
    return { kind: 'text', text: split.text }
  }

  const command = findCommand(split.name, commands)
  if (!command) {
    emit({ kind: 'error', content: unknownCommandLine(split.name, t) })
    return { kind: 'command' }
  }

  if (!command.surfaces.includes(context.surface)) {
    emit({ kind: 'error', content: wrongSurfaceLine(command, t) })
    return { kind: 'command' }
  }

  const unavailableReason = command.getUnavailableReason?.(context, t)
  if (unavailableReason !== undefined) {
    emit({ kind: 'error', content: unavailableReason })
    return { kind: 'command' }
  }

  const parsed = parseArgs(command, split.argText)
  if (!parsed.ok) {
    emit({ kind: 'error', content: argumentFailureLine(parsed, getCommandUsage(command), t) })
    return { kind: 'command' }
  }

  try {
    command.run({
      args: parsed.args,
      context,
      dispatch,
      t,
      emit,
      commands,
    })
  } catch (err) {
    // A command that fell over has already cost the user their input, so it owes them an answer
    // rather than silence.
    logger.error(`Error running the /${command.name} chat command: ${getErrorStack(err)}`)
    emit({ kind: 'error', content: commandFailedLine(command.name, t) })
  }

  return { kind: 'command' }
}
