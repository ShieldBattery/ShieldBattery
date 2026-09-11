import { ChatCommand, matchesCommandName } from './command-schema'
import { closeCommand } from './commands/close'
import { helpCommand } from './commands/help'
import { joinCommand } from './commands/join'
import { banCommand, kickCommand } from './commands/kick-ban'
import { leaveCommand } from './commands/leave'
import { meCommand } from './commands/me'
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
  meCommand,
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

/**
 * Resolves a typed name (without its leading slash, and in whatever case it was typed) to the
 * command it names, wherever that command can be run. Whether it can be run where it was typed is
 * for the caller to ask.
 */
export function findCommand(
  name: string,
  commands: ReadonlyArray<ChatCommand> = ALL_COMMANDS,
): ChatCommand | undefined {
  return commands.find(command => matchesCommandName(command, name))
}
