import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { SbUserId } from '../../../../common/users/sb-user-id'
import { retrieveUserList } from '../../../chat/action-creators'
import { TransInterpolation } from '../../../i18n/i18next'
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

function notInChannelLine(channel: string, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.who.notInChannel'>
      You aren't in <LocalStrong>#{{ channel } as TransInterpolation}</LocalStrong>.
    </Trans>
  )
}

function loadFailedLine(channel: string, err: Error, t: TFunction): React.ReactNode {
  const errorMessage = err.message
  return (
    <Trans t={t} i18nKey='chat.commands.who.loadError'>
      Couldn't load who is in <LocalStrong>#{{ channel } as TransInterpolation}</LocalStrong>:{' '}
      {{ errorMessage } as TransInterpolation}
    </Trans>
  )
}

function memberListLine(
  channel: string,
  onlineNames: ReadonlyArray<string>,
  offlineCount: number,
  t: TFunction,
): React.ReactNode {
  const onlineCount = onlineNames.length
  if (!onlineCount) {
    return (
      <Trans t={t} i18nKey='chat.commands.who.noneOnline'>
        Users in <LocalStrong>#{{ channel } as TransInterpolation}</LocalStrong> (
        {{ onlineCount } as TransInterpolation} online, {{ offlineCount } as TransInterpolation}{' '}
        offline).
      </Trans>
    )
  }

  const names = onlineNames.join(', ')
  return (
    <Trans t={t} i18nKey='chat.commands.who.line'>
      Users in <LocalStrong>#{{ channel } as TransInterpolation}</LocalStrong> (
      {{ onlineCount } as TransInterpolation} online, {{ offlineCount } as TransInterpolation}{' '}
      offline): {{ names } as TransInterpolation}
    </Trans>
  )
}

export const whoCommand = defineCommand({
  name: 'who',
  description: t =>
    t('chat.commands.who.description', 'Lists who is in a channel you have joined.'),
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
            const namesOf = (...idSets: Array<ReadonlySet<SbUserId> | undefined>) =>
              idSets
                .flatMap(ids => Array.from(ids ?? []))
                .map(id => state.users.byId.get(id)?.name)
                .filter(name => name !== undefined)

            // Only the people who are around are named; the rest are counted, so a large channel
            // that everyone stays joined to answers with a line rather than hundreds of names.
            const onlineNames = namesOf(users?.active, users?.idle).sort((a, b) =>
              nameCollator.compare(a, b),
            )
            const offlineCount = namesOf(users?.offline).length

            emit({
              kind: 'info',
              content: memberListLine(channel.name, onlineNames, offlineCount, t),
            })
          },
          onError: err => {
            emit({ kind: 'error', content: loadFailedLine(channel.name, err, t) })
          },
        }),
      )
    })
  },
})
