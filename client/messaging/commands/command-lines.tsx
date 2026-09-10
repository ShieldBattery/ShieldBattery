import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { TransInterpolation } from '../../i18n/i18next'
import { ParseArgsFailure } from './command-parser'
import { LocalStrong } from './local-strong'

/**
 * The line a name that reaches no command answers with. A command that exists but isn't available
 * where it was typed answers with this one too: from the user's side it simply isn't there.
 */
export function unknownCommandLine(name: string, t: TFunction): React.ReactNode {
  const command = `/${name}`
  return (
    <Trans t={t} i18nKey='chat.commands.errors.unknownCommand'>
      Unknown command <LocalStrong>{{ command } as TransInterpolation}</LocalStrong>. Type{' '}
      <LocalStrong>/help</LocalStrong> for a list of commands.
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
