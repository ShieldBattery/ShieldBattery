import { closeWhisperSession } from '../../../whispers/action-creators'
import { defineCommand } from '../command-schema'

export const closeCommand = defineCommand({
  name: 'close',
  description: t => t('chat.commands.close.description', 'Closes this whisper conversation.'),
  surfaces: ['whisper'],
  args: [],

  run({ context, dispatch, t, emit }) {
    if (context.surface !== 'whisper') {
      return
    }

    dispatch(
      closeWhisperSession(context.targetId, {
        // A closed session takes its view with it, so there is nowhere left for a success line.
        onSuccess: () => {},
        onError: err => {
          emit({
            kind: 'error',
            content: t('chat.commands.close.error', {
              defaultValue: "Couldn't close the conversation: {{errorMessage}}",
              errorMessage: err.message,
            }),
          })
        },
      }),
    )
  },
})
