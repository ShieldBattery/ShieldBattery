import { TFunction } from 'i18next'
import { Trans } from 'react-i18next'
import { UserAvailability } from '../../../../common/users/availability'
import { TransInterpolation } from '../../../i18n/i18next'
import { mergeAccountSettings } from '../../../settings/action-creators'
import { getAvailabilityLabel } from '../../../users/availability'
import { ALL_COMMAND_SURFACES, CommandInvocation, defineCommand } from '../command-schema'
import { LocalStrong } from '../local-strong'

function availabilitySetLine(availability: UserAvailability, t: TFunction) {
  const label = getAvailabilityLabel(availability, t)
  return (
    <Trans t={t} i18nKey='chat.commands.availability.set'>
      Your status is now <LocalStrong>{{ label } as TransInterpolation}</LocalStrong>.
    </Trans>
  )
}

/**
 * Sets the running user's availability to `availability`, the same as picking it from their
 * profile, or back to Online if that's what they already have set, so the command that turns a
 * status on also turns it off.
 */
function toggleAvailability(
  availability: UserAvailability,
  { dispatch, t, emit }: Pick<CommandInvocation, 'dispatch' | 't' | 'emit'>,
) {
  dispatch((_, getState) => {
    const current = getState().settings.account.availability
    const next = current === availability ? UserAvailability.Online : availability

    dispatch(
      mergeAccountSettings(
        { availability: next },
        {
          onSuccess: () => emit({ kind: 'info', content: availabilitySetLine(next, t) }),
          onError: err =>
            emit({
              kind: 'error',
              content: t('chat.commands.availability.error', {
                defaultValue: "Couldn't change your status: {{errorMessage}}",
                errorMessage: err.message,
              }),
            }),
        },
      ),
    )
  })
}

export const awayCommand = defineCommand({
  name: 'away',
  description: t =>
    t(
      'chat.commands.away.description',
      'Sets your status to Away, or back to Online if you are already away.',
    ),
  group: 'people',
  surfaces: ALL_COMMAND_SURFACES,
  args: [],

  run(invocation) {
    toggleAvailability(UserAvailability.Away, invocation)
  },
})

export const dndCommand = defineCommand({
  name: 'dnd',
  description: t =>
    t(
      'chat.commands.dnd.description',
      'Sets your status to Do not disturb (muting message sounds and alerts), or back to Online.',
    ),
  group: 'people',
  surfaces: ALL_COMMAND_SURFACES,
  args: [],

  run(invocation) {
    toggleAvailability(UserAvailability.DoNotDisturb, invocation)
  },
})
