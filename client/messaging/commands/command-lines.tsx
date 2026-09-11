import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { TransInterpolation } from '../../i18n/i18next'
import { CommandSurface } from './command-context'
import { ParseArgsFailure } from './command-parser'
import { ALL_COMMAND_SURFACES, ChatCommand } from './command-schema'
import { LocalStrong } from './local-strong'

/** Joins the surfaces a command works in into a list of alternatives, e.g. `channels or lobbies`. */
const surfaceListFormat = new Intl.ListFormat(navigator.language, { type: 'disjunction' })

/** The line a name that reaches no command answers with. */
export function unknownCommandLine(name: string, t: TFunction): React.ReactNode {
  const command = `/${name}`
  return (
    <Trans t={t} i18nKey='chat.commands.errors.unknownCommand'>
      Unknown command <LocalStrong>{{ command } as TransInterpolation}</LocalStrong>. Type{' '}
      <LocalStrong>/help</LocalStrong> for a list of commands.
    </Trans>
  )
}

/** What a sentence listing the surfaces a command works in calls one of them. */
function getSurfaceNoun(surface: CommandSurface, t: TFunction): string {
  switch (surface) {
    case 'channel':
      return t('chat.commands.surfaces.channel', 'channels')
    case 'whisper':
      return t('chat.commands.surfaces.whisper', 'whispers')
    case 'lobby':
      return t('chat.commands.surfaces.lobby', 'lobbies')
    default:
      return assertUnreachable(surface)
  }
}

/** The line a command typed outside the surfaces it works in answers with. */
export function wrongSurfaceLine(command: ChatCommand, t: TFunction): React.ReactNode {
  const name = `/${command.name}`
  // Ordered as the surfaces themselves are rather than as this command happens to list them, so
  // that the same pair of surfaces always reads the same way.
  const surfaces = surfaceListFormat.format(
    ALL_COMMAND_SURFACES.filter(surface => command.surfaces.includes(surface)).map(surface =>
      getSurfaceNoun(surface, t),
    ),
  )

  return (
    <Trans t={t} i18nKey='chat.commands.errors.wrongSurface'>
      <LocalStrong>{{ command: name } as TransInterpolation}</LocalStrong> can only be used in{' '}
      {{ surfaces } as TransInterpolation}.
    </Trans>
  )
}

/** The line a command whose arguments couldn't be read answers with. */
export function argumentFailureLine(
  failure: ParseArgsFailure,
  usage: string,
  t: TFunction,
): React.ReactNode {
  switch (failure.error) {
    case 'missing': {
      const arg = `<${failure.argName}>`
      return (
        <Trans t={t} i18nKey='chat.commands.errors.missingArgument'>
          Missing <LocalStrong>{{ arg } as TransInterpolation}</LocalStrong>. Usage:{' '}
          <LocalStrong>{{ usage } as TransInterpolation}</LocalStrong>
        </Trans>
      )
    }

    case 'invalid': {
      const arg = `<${failure.argName}>`
      const value = `"${failure.value}"`
      return (
        <Trans t={t} i18nKey='chat.commands.errors.invalidArgument'>
          Invalid <LocalStrong>{{ arg } as TransInterpolation}</LocalStrong>:{' '}
          {{ value } as TransInterpolation}. Usage:{' '}
          <LocalStrong>{{ usage } as TransInterpolation}</LocalStrong>
        </Trans>
      )
    }

    case 'extra':
      return (
        <Trans t={t} i18nKey='chat.commands.errors.tooManyArguments'>
          Too many arguments. Usage: <LocalStrong>{{ usage } as TransInterpolation}</LocalStrong>
        </Trans>
      )

    default:
      return assertUnreachable(failure)
  }
}

/** The line a command that threw on its way through answers with. */
export function commandFailedLine(commandName: string, t: TFunction): React.ReactNode {
  const command = `/${commandName}`
  return (
    <Trans t={t} i18nKey='chat.commands.errors.commandFailed'>
      Something went wrong while running{' '}
      <LocalStrong>{{ command } as TransInterpolation}</LocalStrong>.
    </Trans>
  )
}
