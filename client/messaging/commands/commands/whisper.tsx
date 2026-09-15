import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { FriendActivityStatus } from '../../../../common/users/relationships'
import { SbUserId } from '../../../../common/users/sb-user-id'
import { WhisperServiceErrorCode } from '../../../../common/whispers'
import { ReduxAction } from '../../../action-types'
import { DispatchFunction } from '../../../dispatch-registry'
import { TransInterpolation } from '../../../i18n/i18next'
import { isFetchError } from '../../../network/fetch-errors'
import {
  navigateToWhisper,
  sendMessage as sendWhisperMessage,
  startWhisperSessionByName,
} from '../../../whispers/action-creators'
import { CommandContext } from '../command-context'
import {
  ALL_COMMAND_SURFACES,
  ArgSuggestDeps,
  ArgSuggestion,
  defineCommand,
} from '../command-schema'
import { LocalLineEmitter } from '../local-output'
import { LocalStrong } from '../local-strong'

function startFailedLine(target: string, err: Error, t: TFunction): React.ReactNode {
  const code = isFetchError(err) ? err.code : undefined

  if (code === WhisperServiceErrorCode.UserNotFound) {
    return (
      <Trans t={t} i18nKey='chat.commands.whisper.userNotFound'>
        No user named <LocalStrong>{{ target } as TransInterpolation}</LocalStrong>.
      </Trans>
    )
  } else if (code === WhisperServiceErrorCode.NoSelfMessaging) {
    return t('chat.commands.whisper.noSelfMessaging', "You can't whisper yourself.")
  }

  const errorMessage = err.message
  return (
    <Trans t={t} i18nKey='chat.commands.whisper.startError'>
      Couldn't start a whisper with <LocalStrong>{{ target } as TransInterpolation}</LocalStrong>:{' '}
      {{ errorMessage } as TransInterpolation}
    </Trans>
  )
}

function sendFailedLine(target: string, err: Error, t: TFunction): React.ReactNode {
  const errorMessage = err.message
  return (
    <Trans t={t} i18nKey='chat.commands.whisper.sendError'>
      Couldn't send the whisper to <LocalStrong>{{ target } as TransInterpolation}</LocalStrong>:{' '}
      {{ errorMessage } as TransInterpolation}
    </Trans>
  )
}

/** The line that stands in for the outgoing echo where nothing else on the surface shows a send. */
function whisperSentLine(target: string, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.whisper.sent'>
      Whisper sent to <LocalStrong>{{ target } as TransInterpolation}</LocalStrong>.
    </Trans>
  )
}

/** What sending a whisper from a surface other than its conversation needs from that surface. */
export interface SendWhisperDeps {
  context: CommandContext
  dispatch: DispatchFunction<ReduxAction>
  t: TFunction
  emit: LocalLineEmitter
}

/**
 * Whispers `text` to `target` without leaving the surface it was typed in. While whispers are
 * echoed into every chat, the outgoing echo is what shows it went out. With the echo turned off
 * nothing on the surface would show it, so a line saying it was sent stands in — except in the
 * target's own conversation, where the whisper itself appears. A failed send answers with
 * `failedLine` next to the input.
 */
export function sendWhisperInPlace(
  target: { id: SbUserId; name: string },
  text: string,
  deps: SendWhisperDeps,
  failedLine: (err: Error) => React.ReactNode,
): void {
  const { context, dispatch, t, emit } = deps

  dispatch((dispatch, getState) => {
    dispatch(
      sendWhisperMessage(target.id, text, {
        onSuccess: () => {
          const { settings } = getState()
          const inOwnConversation = context.surface === 'whisper' && context.targetId === target.id
          if (!settings.account.showWhispersEverywhere && !inOwnConversation) {
            emit({ kind: 'info', content: whisperSentLine(target.name, t) })
          }
        },
        onError: err => emit({ kind: 'error', content: failedLine(err) }),
      }),
    )
  })
}

/**
 * Who a whisper is likeliest to be meant for, best first: the conversations already open (most
 * recently active first), then friends (online ones ahead of offline ones), then whoever else is
 * in the surface the command was typed in. Each user is offered once, in the best position they
 * reach, and the user running the command is never offered, since the server refuses self-whispers.
 */
function getWhisperTargets({ context, getState }: ArgSuggestDeps): ArgSuggestion[] {
  const { relationships, users, whispers } = getState()

  const suggestions: ArgSuggestion[] = []
  const offered = new Set<SbUserId>([context.selfUserId])
  const offer = (id: SbUserId, online?: boolean) => {
    const name = users.byId.get(id)?.name
    if (offered.has(id) || name === undefined) {
      return
    }

    offered.add(id)
    suggestions.push({ value: name, user: { id, online } })
  }

  for (const id of whispers.sessions) {
    // The client tracks no presence for the people it has conversations with.
    offer(id)
  }

  const friendIds = Array.from(relationships.friends.keys())
  const isFriendOnline = (id: SbUserId) =>
    relationships.friendActivityStatus.get(id) !== FriendActivityStatus.Offline
  for (const id of friendIds.filter(isFriendOnline)) {
    offer(id, true)
  }
  for (const id of friendIds.filter(id => !isFriendOnline(id))) {
    offer(id, false)
  }

  if (context.surface === 'channel') {
    for (const member of context.members) {
      offer(member.id, member.online)
    }
  }

  return suggestions
}

export const whisperCommand = defineCommand({
  name: 'whisper',
  aliases: ['w', 'm', 'msg', 'tell', 't'],
  description: t => t('chat.commands.whisper.description', 'Sends a private message to a user.'),
  surfaces: ALL_COMMAND_SURFACES,
  args: [
    { kind: 'user', name: 'user', suggest: getWhisperTargets },
    { kind: 'rest', name: 'message', optional: true },
  ],

  run({ args, context, dispatch, t, emit }) {
    const target = args.user
    const message = args.message

    dispatch(
      startWhisperSessionByName(target, {
        onSuccess: ({ userId }) => {
          if (message === undefined) {
            navigateToWhisper(userId, target)
            return
          }

          // A whisper sent with the message spelled out leaves the user where they were:
          // sendWhisperInPlace shows it went out, and a send that fails puts the error next to
          // the input they typed it in.
          sendWhisperInPlace(
            { id: userId, name: target },
            message,
            { context, dispatch, t, emit },
            err => sendFailedLine(target, err, t),
          )
        },
        onError: err => emit({ kind: 'error', content: startFailedLine(target, err, t) }),
      }),
    )
  },
})
