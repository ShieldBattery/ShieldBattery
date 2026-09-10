import { CommandContext } from './command-context'
import { ChatCommand, matchesCommandName } from './command-schema'
import { closeCommand } from './commands/close'
import { helpCommand } from './commands/help'
import { joinCommand } from './commands/join'
import { banCommand, kickCommand } from './commands/kick-ban'
import { leaveCommand } from './commands/leave'
import { whisperCommand } from './commands/whisper'

/** Every command there is, in the order help lists them. */
export const ALL_COMMANDS: ReadonlyArray<ChatCommand> = [
  helpCommand,
  joinCommand,
  whisperCommand,
  leaveCommand,
  closeCommand,
  kickCommand,
  banCommand,
]

/**
 * Fails loudly on a name or alias that two commands both answer to: a typed name resolves to
 * whichever of them is listed first, so the other would quietly become unreachable.
 */
function assertUniqueCommandNames(commands: ReadonlyArray<ChatCommand>): void {
  const seen = new Set<string>()

  for (const command of commands) {
    for (const name of [command.name, ...(command.aliases ?? [])]) {
      const lowered = name.toLowerCase()
      if (seen.has(lowered)) {
        throw new Error(`More than one chat command answers to /${lowered}`)
      }
      seen.add(lowered)
    }
  }
}

assertUniqueCommandNames(ALL_COMMANDS)

/** Whether a command exists at all in a particular context. */
export function isCommandAvailable(command: ChatCommand, context: CommandContext): boolean {
  return command.surfaces.includes(context.surface) && (command.isAvailable?.(context) ?? true)
}

/** The commands that can run in a context, in display order. */
export function getAvailableCommands(
  context: CommandContext,
  commands: ReadonlyArray<ChatCommand> = ALL_COMMANDS,
): ReadonlyArray<ChatCommand> {
  return commands.filter(command => isCommandAvailable(command, context))
}

/**
 * Resolves a typed name (without its leading slash, and in whatever case it was typed) to a
 * command that can run in `context`. A command that exists but can't run there is not found, which
 * is what makes it indistinguishable from one that doesn't exist.
 */
export function findCommand(
  name: string,
  context: CommandContext,
  commands: ReadonlyArray<ChatCommand> = ALL_COMMANDS,
): ChatCommand | undefined {
  return getAvailableCommands(context, commands).find(command => matchesCommandName(command, name))
}
