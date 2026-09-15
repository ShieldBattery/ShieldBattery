import { TFunction } from 'i18next'
import { describe, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../../../common/chat'
import { makeSbUserId } from '../../../../common/users/sb-user-id'
import { ChannelCommandContext } from '../command-context'
import { LocalLineContent } from '../local-output'
import { runChatCommandWith } from '../run-chat-command'
import { shrugCommand, tableflipCommand, unflipCommand } from './text-transforms'

// Answers with whatever default value the caller supplied, which is what the real translations
// hold for English anyway.
const t = ((key: string, options?: string | { defaultValue?: string }) =>
  typeof options === 'string' ? options : (options?.defaultValue ?? key)) as unknown as TFunction

const channelContext: ChannelCommandContext = {
  surface: 'channel',
  channelId: makeSbChannelId(1),
  selfUserId: makeSbUserId(1),
  members: [],
  canKick: false,
  canBan: false,
  canEditChannel: false,
}

function runInput(input: string) {
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const dispatch = vi.fn()
  const result = runChatCommandWith([shrugCommand, tableflipCommand, unflipCommand], input, {
    context: channelContext,
    dispatch,
    t,
    emit,
  })

  return { result, emit, dispatch }
}

describe('messaging/commands/commands/text-transforms', () => {
  test('/shrug with no text sends just the face', () => {
    const { result, dispatch, emit } = runInput('/shrug')

    expect(result).toEqual({ kind: 'text', text: '¯\\_(ツ)_/¯' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  test('/shrug with text appends the face to it', () => {
    const { result, dispatch, emit } = runInput('/shrug well then')

    expect(result).toEqual({ kind: 'text', text: 'well then ¯\\_(ツ)_/¯' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  test('/tableflip sends the table flip', () => {
    const { result, dispatch, emit } = runInput('/tableflip')

    expect(result).toEqual({ kind: 'text', text: '(╯°□°)╯︵ ┻━┻' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  test('/tableflip with extra text is refused with the too-many-arguments line', () => {
    const { result, dispatch, emit } = runInput('/tableflip extra')

    expect(result).toEqual({ kind: 'command' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(
      (emit.mock.calls[0][0].content as unknown as { props: { i18nKey: string } }).props.i18nKey,
    ).toBe('chat.commands.errors.tooManyArguments')
  })

  test('/unflip sends the table restored', () => {
    const { result, dispatch, emit } = runInput('/unflip')

    expect(result).toEqual({ kind: 'text', text: '┬─┬ ノ( ゜-゜ノ)' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })
})
