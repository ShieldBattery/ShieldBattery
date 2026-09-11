import {
  getJoinChannelErrorMessage,
  joinChannel,
  navigateToChannel,
} from '../../../chat/action-creators'
import { openDialog } from '../../../dialogs/action-creators'
import { DialogType } from '../../../dialogs/dialog-type'
import { ALL_COMMAND_SURFACES, defineCommand } from '../command-schema'

export const joinCommand = defineCommand({
  name: 'join',
  aliases: ['j', 'channel'],
  description: t =>
    t('chat.commands.join.description', 'Joins a chat channel, creating it if it does not exist.'),
  surfaces: ALL_COMMAND_SURFACES,
  args: [{ kind: 'channel', name: 'channel' }],

  run({ args, dispatch, emit }) {
    const typedName = args.channel

    dispatch((_, getState) => {
      const { chat } = getState()
      // Channel names are unique regardless of case, so the one the client knows about is the one
      // the server would resolve this to.
      const known = Array.from(chat.idToBasicInfo.values()).find(
        info => info.name.toLowerCase() === typedName.toLowerCase(),
      )

      const join = (channelName: string) => {
        dispatch(
          joinChannel(channelName, {
            onSuccess: result => navigateToChannel(result.channelInfo.id, result.channelInfo.name),
            onError: err => {
              emit({ kind: 'error', content: getJoinChannelErrorMessage(err, channelName) })
            },
          }),
        )
      }

      if (known && chat.joinedChannels.has(known.id)) {
        // Already a member, so this is just a way to get to the channel. Arriving there is the
        // whole answer; a line saying so would only be noise.
        navigateToChannel(known.id, known.name)
      } else if (known) {
        join(known.name)
      } else {
        // A name nothing is known about would be created by joining it, which makes the joiner its
        // owner: worth asking about first.
        dispatch(
          openDialog({
            type: DialogType.ChannelCreateConfirmation,
            initData: { channelName: typedName, onConfirm: () => join(typedName) },
          }),
        )
      }
    })
  },
})
