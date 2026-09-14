import { Trans } from 'react-i18next'
import { TransInterpolation } from '../../../i18n/i18next'
import { ConnectedUsername } from '../../../users/connected-username'
import { ALL_COMMAND_SURFACES, defineCommand } from '../command-schema'
import { LocalStrong } from '../local-strong'

export const whoamiCommand = defineCommand({
  name: 'whoami',
  description: t =>
    t('chat.commands.whoami.description', 'Shows the name and user ID you are logged in as.'),
  surfaces: ALL_COMMAND_SURFACES,
  args: [],

  run({ context, dispatch, t, emit }) {
    dispatch((_, getState) => {
      const { auth } = getState()
      const id = auth.self?.user.id ?? context.selfUserId

      emit({
        kind: 'info',
        content: (
          <Trans t={t} i18nKey='chat.commands.whoami.line'>
            You are{' '}
            <LocalStrong>
              <ConnectedUsername userId={id} />
            </LocalStrong>{' '}
            (user ID {{ id } as TransInterpolation}).
          </Trans>
        ),
      })
    })
  },
})
