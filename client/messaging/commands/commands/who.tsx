import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { SbChannelId } from '../../../../common/chat'
import { SbUserId } from '../../../../common/users/sb-user-id'
import { retrieveUserList } from '../../../chat/action-creators'
import { ConnectedChannelName } from '../../../chat/connected-channel-name'
import { TransInterpolation } from '../../../i18n/i18next'
import { ConnectedUsername } from '../../../users/connected-username'
import {
  ALL_COMMAND_SURFACES,
  ArgSuggestDeps,
  ArgSuggestion,
  defineCommand,
} from '../command-schema'
import { LocalStrong } from '../local-strong'

/** Orders names the way a reader looks for them, rather than putting every capital first. */
const nameCollator = new Intl.Collator(navigator.language, { sensitivity: 'base' })

/**
 * The answer is a glance, not a roster: naming every online member would swamp a busy channel.
 * The command only works for channels the caller has joined, and the channel's own member list is
 * where everyone can already be seen, so a short, most-likely-to-be-around sample is enough here.
 */
const MAX_NAMED_ONLINE = 5

/**
 * The channels the caller has joined. The command only answers for those, so offering any other
 * channel the client happens to know about would only lead to the not-in-channel line.
 */
function getJoinedChannels({ getState }: ArgSuggestDeps): ArgSuggestion[] {
  const { chat } = getState()
  const suggestions: ArgSuggestion[] = []
  for (const info of chat.idToBasicInfo.values()) {
    if (chat.joinedChannels.has(info.id)) {
      suggestions.push({ value: info.name })
    }
  }

  return suggestions
}

/** The online users in a `who` answer, comma-separated and each individually clickable. */
function OnlineUserList({
  users,
}: {
  users: ReadonlyArray<{ id: SbUserId; name: string }>
}): React.ReactNode {
  return (
    <>
      {users.map((user, i) => (
        <React.Fragment key={user.id}>
          {i > 0 ? ', ' : undefined}
          <ConnectedUsername userId={user.id} />
        </React.Fragment>
      ))}
    </>
  )
}

function notInChannelLine(channel: string, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.who.notInChannel'>
      You aren't in <LocalStrong>#{{ channel } as TransInterpolation}</LocalStrong>.
    </Trans>
  )
}

function loadFailedLine(channelId: SbChannelId, err: Error, t: TFunction): React.ReactNode {
  const errorMessage = err.message
  return (
    <Trans t={t} i18nKey='chat.commands.who.loadError'>
      Couldn't load who is in{' '}
      <LocalStrong>
        <ConnectedChannelName channelId={channelId} />
      </LocalStrong>
      : {{ errorMessage } as TransInterpolation}
    </Trans>
  )
}

function memberListLine(
  channelId: SbChannelId,
  namedOnlineUsers: ReadonlyArray<{ id: SbUserId; name: string }>,
  moreCount: number,
  offlineCount: number,
  t: TFunction,
): React.ReactNode {
  const onlineCount = namedOnlineUsers.length + moreCount
  if (!onlineCount) {
    return (
      <Trans t={t} i18nKey='chat.commands.who.noneOnline'>
        Users in{' '}
        <LocalStrong>
          <ConnectedChannelName channelId={channelId} />
        </LocalStrong>{' '}
        ({{ onlineCount } as TransInterpolation} online, {{ offlineCount } as TransInterpolation}{' '}
        offline).
      </Trans>
    )
  }

  if (moreCount > 0) {
    return (
      <Trans t={t} i18nKey='chat.commands.who.lineTruncated' count={moreCount}>
        Users in{' '}
        <LocalStrong>
          <ConnectedChannelName channelId={channelId} />
        </LocalStrong>{' '}
        ({{ onlineCount } as TransInterpolation} online, {{ offlineCount } as TransInterpolation}{' '}
        offline): <OnlineUserList users={namedOnlineUsers} /> and{' '}
        {{ count: moreCount } as TransInterpolation} more
      </Trans>
    )
  }

  return (
    <Trans t={t} i18nKey='chat.commands.who.line'>
      Users in{' '}
      <LocalStrong>
        <ConnectedChannelName channelId={channelId} />
      </LocalStrong>{' '}
      ({{ onlineCount } as TransInterpolation} online, {{ offlineCount } as TransInterpolation}{' '}
      offline): <OnlineUserList users={namedOnlineUsers} />
    </Trans>
  )
}

export const whoCommand = defineCommand({
  name: 'who',
  description: t =>
    t('chat.commands.who.description', 'Lists who is in a channel you have joined.'),
  group: 'chat',
  surfaces: ALL_COMMAND_SURFACES,
  args: [{ kind: 'channel', name: 'channel', exhaustive: true, suggest: getJoinedChannels }],

  run({ args, dispatch, t, emit }) {
    const typedName = args.channel

    dispatch((_, getState) => {
      // Channel names are unique regardless of case, so the joined channel that goes by this name
      // is the one the server would resolve it to.
      const lowered = typedName.toLowerCase()
      const { chat } = getState()
      const channel = Array.from(chat.idToBasicInfo.values()).find(
        info => chat.joinedChannels.has(info.id) && info.name.toLowerCase() === lowered,
      )

      if (!channel) {
        emit({ kind: 'error', content: notInChannelLine(typedName, t) })
        return
      }

      dispatch(
        retrieveUserList(channel.id, {
          onSuccess: () => {
            // The list may have been loaded long before this command ran, so the answer is built
            // from the store rather than from anything the request handed back.
            const state = getState()
            const users = state.chat.idToUsers.get(channel.id)
            const namesOf = (
              ...idSets: Array<ReadonlySet<SbUserId> | undefined>
            ): Array<{ id: SbUserId; name: string }> =>
              idSets
                .flatMap(ids => Array.from(ids ?? []))
                .flatMap(id => {
                  const name = state.users.byId.get(id)?.name
                  return name !== undefined ? [{ id, name }] : []
                })

            // Active members come before idle ones, since they're the likelier to still be
            // around; only the first MAX_NAMED_ONLINE of that order are named and the rest are
            // counted, so a large channel that everyone stays joined to answers with a line
            // rather than hundreds of names.
            const byName = (a: { name: string }, b: { name: string }) =>
              nameCollator.compare(a.name, b.name)
            const onlineUsers = [
              ...namesOf(users?.active).sort(byName),
              ...namesOf(users?.idle).sort(byName),
            ]
            const namedOnlineUsers = onlineUsers.slice(0, MAX_NAMED_ONLINE)
            const moreCount = onlineUsers.length - namedOnlineUsers.length
            const offlineCount = namesOf(users?.offline).length

            emit({
              kind: 'info',
              content: memberListLine(channel.id, namedOnlineUsers, moreCount, offlineCount, t),
            })
          },
          onError: err => {
            emit({ kind: 'error', content: loadFailedLine(channel.id, err, t) })
          },
        }),
      )
    })
  },
})
