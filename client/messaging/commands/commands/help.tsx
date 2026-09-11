import { Trans } from 'react-i18next'
import { openDialog } from '../../../dialogs/action-creators'
import { DialogType } from '../../../dialogs/dialog-type'
import { TransInterpolation } from '../../../i18n/i18next'
import { unknownCommandLine } from '../command-lines'
import {
  ALL_COMMAND_SURFACES,
  defineCommand,
  formatAliases,
  getCommandArgUsages,
  getCommandUsage,
  matchesCommandName,
} from '../command-schema'
import { LocalStrong } from '../local-strong'

export const helpCommand = defineCommand({
  name: 'help',
  aliases: ['?'],
  description: t => t('chat.commands.help.description', 'Lists the commands you can use here.'),
  surfaces: ALL_COMMAND_SURFACES,
  args: [{ kind: 'word', name: 'command', optional: true }],

  run({ args, dispatch, t, emit, availableCommands }) {
    if (args.command === undefined) {
      dispatch(
        openDialog({
          type: DialogType.ChatCommandHelp,
          initData: {
            commands: availableCommands.map(command => ({
              name: command.name,
              aliases: [...(command.aliases ?? [])],
              args: getCommandArgUsages(command),
              description: command.description(t),
            })),
          },
        }),
      )
      return
    }

    // A command is just as likely to be typed with its slash as without it.
    const typedName = args.command.startsWith('/') ? args.command.slice(1) : args.command
    const command = availableCommands.find(c => matchesCommandName(c, typedName))
    if (!command) {
      emit({ kind: 'error', content: unknownCommandLine(typedName, t) })
      return
    }

    const usage = getCommandUsage(command)
    const description = command.description(t)
    const aliases = formatAliases(command)

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
        </>
      ),
    })
  },
})
