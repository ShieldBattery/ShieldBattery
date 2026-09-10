import { leaveChannelWithConfirmation } from '../../../chat/action-creators'
import { leaveLobby } from '../../../lobbies/action-creators'
import { defineCommand } from '../command-schema'

export const leaveCommand = defineCommand({
  name: 'leave',
  description: t => t('chat.commands.leave.description', 'Leaves the channel or lobby you are in.'),
  surfaces: ['channel', 'lobby'],
  args: [],

  run({ context, dispatch }) {
    if (context.surface === 'channel') {
      dispatch(leaveChannelWithConfirmation(context.channelId))
    } else if (context.surface === 'lobby') {
      dispatch(leaveLobby())
    }
  },
})
