import { Trans } from 'react-i18next'
import { openDialog } from '../../../dialogs/action-creators'
import { DialogType } from '../../../dialogs/dialog-type'
import { TransInterpolation } from '../../../i18n/i18next'
import { unknownCommandLine, wrongSurfaceLine } from '../command-lines'
import {
  ALL_COMMAND_SURFACES,
  defineCommand,
  formatAliases,
  getCommandArgUsages,
  getCommandUsage,
  getSurfaceCommands,
  matchesCommandName,
} from '../command-schema'
import { LocalStrong } from '../local-strong'

export const helpCommand = defineCommand({
  name: 'help',
  aliases: ['?'],
  description: t => t('chat.commands.help.description', 'Lists the commands you can use here.'),
  surfaces: ALL_COMMAND_SURFACES,
  args: [{ kind: 'word', name: 'command', optional: true }],

  run({ args, context, dispatch, t, emit, commands }) {
    if (args.command === undefined) {
      dispatch(
        openDialog({
          type: DialogType.ChatCommandHelp,
          initData: {
            commands: getSurfaceCommands(commands, context.surface).map(command => ({
              name: command.name,
              aliases: [...(command.aliases ?? [])],
              args: getCommandArgUsages(command),
              description: command.description(t),
              unavailableReason: command.getUnavailableReason?.(context, t),
            })),
          },
        }),
      )
      return
    }

    // A command is just as likely to be typed with its slash as without it.
    const typedName = args.command.startsWith('/') ? args.command.slice(1) : args.command
    const command = commands.find(c => matchesCommandName(c, typedName))
    if (!command) {
      emit({ kind: 'error', content: unknownCommandLine(typedName, t) })
      return
    }

    const usage = getCommandUsage(command)
    const description = command.description(t)
    const aliases = formatAliases(command)
    // Naming a command answers for it wherever it lives, so one that can't be run from here has to
    // say so alongside what it does.
    const unavailable = !command.surfaces.includes(context.surface)
      ? wrongSurfaceLine(command, t)
      : command.getUnavailableReason?.(context, t)

    emit({
      kind: 'info',
      content: (
        <>
          <Trans t={t} i18nKey='chat.commands.help.commandLine'>
            <LocalStrong>{{ usage } as TransInterpolation}</LocalStrong> —{' '}
            {{ description } as TransInterpolation}
          </Trans>
          {aliases ? (
            <>
              {' '}
              <Trans t={t} i18nKey='chat.commands.help.aliasesLine'>
                Aliases: <LocalStrong>{{ aliases } as TransInterpolation}</LocalStrong>
              </Trans>
            </>
          ) : undefined}
          {unavailable ? <> {unavailable}</> : undefined}
        </>
      ),
    })
  },
})
