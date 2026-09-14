import { Trans } from 'react-i18next'
import { TransInterpolation } from '../../../i18n/i18next'
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
      const { auth, users } = getState()
      const self = auth.self?.user
      const id = self?.id ?? context.selfUserId
      // The surface always knows which id ran the command, so the name is the only thing worth
      // falling back for.
      const name = self?.name ?? users.byId.get(context.selfUserId)?.name ?? ''

      emit({
        kind: 'info',
        content: (
          <Trans t={t} i18nKey='chat.commands.whoami.line'>
            You are <LocalStrong>{{ name } as TransInterpolation}</LocalStrong> (user ID{' '}
            {{ id } as TransInterpolation}).
          </Trans>
        ),
      })
    })
  },
})
