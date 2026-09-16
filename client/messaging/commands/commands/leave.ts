import { getErrorStack } from '../../../../common/errors'
import { leaveChannelWithConfirmation } from '../../../chat/action-creators'
import { leaveLobby } from '../../../lobbies/action-creators'
import logger from '../../../logging/logger'
import { defineCommand } from '../command-schema'

export const leaveCommand = defineCommand({
  name: 'leave',
  description: t => t('chat.commands.leave.description', 'Leaves the channel or lobby you are in.'),
  group: 'chat',
  surfaces: ['channel', 'lobby'],
  args: [],

  run({ context, dispatch }) {
    if (context.surface === 'channel') {
      dispatch(leaveChannelWithConfirmation(context.channelId))
    } else if (context.surface === 'lobby') {
      dispatch(
        leaveLobby({
          onSuccess: () => {},
          onError: err => {
            logger.error(`Error while leaving a lobby: ${getErrorStack(err)}`)
          },
        }),
      )
    }
  },
})
