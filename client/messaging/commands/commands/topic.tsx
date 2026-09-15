import { TFunction } from 'i18next'
import { Trans } from 'react-i18next'
import { ChatServiceErrorCode } from '../../../../common/chat'
import { updateChannel } from '../../../chat/action-creators'
import { TransInterpolation } from '../../../i18n/i18next'
import { isFetchError } from '../../../network/fetch-errors'
import { defineCommand } from '../command-schema'
import { LocalStrong } from '../local-strong'

function noPermission(t: TFunction): string {
  return t(
    'chat.commands.topic.noPermission',
    'Only the channel owner and server moderators can change the topic.',
  )
}

export const topicCommand = defineCommand({
  name: 'topic',
  description: t => t('chat.commands.topic.description', "Sets this channel's topic."),
  surfaces: ['channel'],
  getUnavailableReason: (context, t) =>
    context.surface === 'channel' && !context.canEditChannel ? noPermission(t) : undefined,
  args: [{ kind: 'rest', name: 'text' }],

  run({ args, context, dispatch, t, emit }) {
    if (context.surface !== 'channel') {
      return
    }

    const topic = args.text
    dispatch(
      updateChannel({
        channelId: context.channelId,
        channelChanges: { topic },
        spec: {
          onSuccess: () =>
            emit({
              kind: 'info',
              content: (
                <Trans t={t} i18nKey='chat.commands.topic.set'>
                  Topic set to: <LocalStrong>{{ topic } as TransInterpolation}</LocalStrong>
                </Trans>
              ),
            }),
          onError: err =>
            emit({
              kind: 'error',
              content:
                isFetchError(err) && err.code === ChatServiceErrorCode.CannotEditChannel
                  ? noPermission(t)
                  : t('chat.commands.topic.error', {
                      defaultValue: "Couldn't set the topic: {{errorMessage}}",
                      errorMessage: err.message,
                    }),
            }),
        },
      }),
    )
  },
})
