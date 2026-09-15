import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { WhisperServiceErrorCode } from '../../../../common/whispers'
import { ReduxAction } from '../../../action-types'
import { DispatchFunction } from '../../../dispatch-registry'
import { TransInterpolation } from '../../../i18n/i18next'
import { jotaiStore } from '../../../jotai-store'
import { isFetchError } from '../../../network/fetch-errors'
import { RootState } from '../../../root-reducer'
import { sendMessage as sendWhisperMessage } from '../../../whispers/action-creators'
import { lastWhisperSenderAtom } from '../../../whispers/whisper-atoms'
import {
  ALL_COMMAND_SURFACES,
  defineCommand,
  matchesCommandName,
  ReplyTarget,
} from '../command-schema'
import { LocalLineEmitter } from '../local-output'
import { LocalStrong } from '../local-strong'

export type { ReplyTarget }

/**
 * Whether `text` reads as the reply command: a single leading slash (a doubled one escapes to a
 * literal slash and is never a command), then one of the command's names, then either the end of
 * the text or one whitespace character and the message. `rest` is everything past that whitespace,
 * exactly as it was typed. Leading whitespace is skipped, since submitting trims it too.
 */
export function matchReplyCommand(
  text: string,
): { hasSeparator: boolean; rest: string } | undefined {
  const match = /^\/([^\s/]+)(?:(\s)([\s\S]*))?$/.exec(text.trimStart())
  if (!match || !matchesCommandName(replyCommand, match[1])) {
    return undefined
  }

  return match[2] === undefined
    ? { hasSeparator: false, rest: '' }
    : { hasSeparator: true, rest: match[3] }
}

/**
 * Who a reply typed right now would go to: whoever whispered most recently. Undefined when nobody
 * has, or when the client doesn't know that user's name — a whisper event carries its sender's
 * user info, so a missing name means nothing has arrived from them this session.
 */
export function resolveReplyTarget(state: RootState): ReplyTarget | undefined {
  const id = jotaiStore.get(lastWhisperSenderAtom)
  if (id === undefined) {
    return undefined
  }

  const name = state.users.byId.get(id)?.name
  return name !== undefined ? { id, name } : undefined
}

/** The line answering a reply typed before anyone has whispered this user. */
export function noReplyTargetLine(t: TFunction): React.ReactNode {
  return t(
    'chat.commands.reply.noTarget',
    "No one has whispered you yet, so there's no one to reply to.",
  )
}

function replyFailedLine(target: string, err: Error, t: TFunction): React.ReactNode {
  const code = isFetchError(err) ? err.code : undefined

  if (code === WhisperServiceErrorCode.UserChatRestricted) {
    return t(
      'chat.commands.reply.chatRestricted',
      "You're currently restricted from sending chat messages.",
    )
  }

  const errorMessage = err.message
  return (
    <Trans t={t} i18nKey='chat.commands.reply.sendError'>
      Couldn't send your reply to <LocalStrong>{{ target } as TransInterpolation}</LocalStrong>:{' '}
      {{ errorMessage } as TransInterpolation}
    </Trans>
  )
}

/** What sending a reply needs from the surface it was composed in. */
export interface SendReplyDeps {
  dispatch: DispatchFunction<ReduxAction>
  t: TFunction
  emit: LocalLineEmitter
}

/**
 * Whispers `text` to `target`. A failed send answers next to the input it was typed in, since the
 * surface showing that input is not the conversation the whisper was meant for.
 */
export function sendReply(target: ReplyTarget, text: string, deps: SendReplyDeps): void {
  const { dispatch, t, emit } = deps

  dispatch(
    sendWhisperMessage(target.id, text, {
      onSuccess: () => {},
      onError: err => emit({ kind: 'error', content: replyFailedLine(target.name, err, t) }),
    }),
  )
}

export const replyCommand = defineCommand({
  name: 'reply',
  aliases: ['r'],
  description: t =>
    t('chat.commands.reply.description', 'Whispers back to the last person who whispered you.'),
  surfaces: ALL_COMMAND_SURFACES,
  args: [{ kind: 'rest', name: 'message', optional: true }],

  run({ args, dispatch, t, emit, enterReplyMode }) {
    dispatch((_, getState) => {
      const target = resolveReplyTarget(getState())
      if (!target) {
        emit({ kind: 'info', content: noReplyTargetLine(t) })
        return
      }

      if (args.message === undefined) {
        // A bare reply puts the input into reply mode with the target locked, so the message is
        // typed next to the chip rather than after the command.
        enterReplyMode?.(target)
        return
      }

      sendReply(target, args.message, { dispatch, t, emit })
    })
  },
})
