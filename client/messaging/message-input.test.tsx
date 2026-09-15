import { act, fireEvent, render } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { Provider as ReduxProvider } from 'react-redux'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import createStore from '../create-store'
import { KeyListenerBoundary } from '../keyboard/key-listener'
import { CommandContext } from './commands/command-context'
import { ReplyTarget } from './commands/command-schema'
import { MessageInput, MessageInputHandle } from './message-input'
import { TypeaheadMatch, TypeaheadSuggestion } from './typeahead'

// The emote provider is the last one the input asks, so standing in for it puts a palette under the
// test's control without the input needing a seam of its own.
const fakeProvider = vi.hoisted(() => ({
  match: undefined as ((textBeforeCaret: string) => TypeaheadMatch | undefined) | undefined,
}))

vi.mock('./emote-provider', () => ({
  emoteProvider: {
    id: 'fake',
    match: (textBeforeCaret: string) => fakeProvider.match?.(textBeforeCaret),
  },
}))

const runChatCommand = vi.hoisted(() => vi.fn())

vi.mock('./commands/run-chat-command', () => ({ runChatCommand }))

// Who there is to reply to, and what sending a reply does, are the two pieces of the reply command
// that reach outside the input. Standing in for them leaves the input's own parsing real.
const reply = vi.hoisted(() => ({
  target: undefined as ReplyTarget | undefined,
  sendReply: vi.fn(),
}))

vi.mock('./commands/commands/reply', async importOriginal => ({
  ...(await importOriginal<typeof import('./commands/commands/reply')>()),
  resolveReplyTarget: () => reply.target,
  sendReply: reply.sendReply,
}))

// The reply chip is built with `Trans`, which needs an i18next instance to render against.
// `escapeValue` matches how the app initializes i18next: React escapes what it renders, so escaping
// again would put entities on screen in place of the punctuation these lines are made of.
beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

/** What the fake provider answers with, minus where in the message the word being completed sits. */
type Offer = Omit<TypeaheadMatch, 'start' | 'matchedText'>

/** Points the fake provider at the last word typed, answering with what `offer` gives for it. */
function claimLastWord(offer: (query: string) => Offer | undefined) {
  fakeProvider.match = textBeforeCaret => {
    const start = textBeforeCaret.lastIndexOf(' ') + 1
    const query = textBeforeCaret.slice(start)
    const answer = query.length > 0 ? offer(query) : undefined
    return answer ? { start, matchedText: query, ...answer } : undefined
  }
}

function row(text: string, exact = false): TypeaheadSuggestion {
  return { key: `row:${text}`, text, visual: { kind: 'plain' }, insertText: `${text} `, exact }
}

const ROWS = [row('alpha'), row('alpine'), row('beta')]

/** The rows starting with `query`, the one that spells it out marked exact. */
function rowsMatching(query: string): TypeaheadSuggestion[] {
  return ROWS.filter(r => r.text.startsWith(query)).map(r => row(r.text, r.text === query))
}

const commandContext: CommandContext = { surface: 'lobby', selfUserId: makeSbUserId(1) }

function renderInput() {
  const onSendChatMessage = vi.fn()
  const emit = vi.fn()
  const handle: { current: MessageInputHandle | null } = { current: null }
  const { container } = render(
    <ReduxProvider store={createStore()}>
      <KeyListenerBoundary>
        <MessageInput
          ref={handle}
          onSendChatMessage={onSendChatMessage}
          commands={{ context: commandContext, emit }}
        />
      </KeyListenerBoundary>
    </ReduxProvider>,
  )

  const textarea = container.querySelector('textarea')!

  /** Moves the caret, the way the browser tells the input a caret has moved. */
  const caretAt = (position: number) => {
    textarea.selectionStart = position
    textarea.selectionEnd = position
    fireEvent(textarea, new Event('selectionchange'))
  }

  /** Replaces what is in the input and leaves the caret at the end of it. */
  const type = (text: string) => {
    fireEvent.change(textarea, { target: { value: text } })
    caretAt(text.length)
  }

  /** Answers false when the key's default was prevented. */
  const press = (key: string) => fireEvent.keyDown(textarea, { key, code: key })

  /** The id of the palette the input says it is showing, or null while it shows none. */
  const listId = () => textarea.getAttribute('aria-controls')

  const options = () => {
    const id = listId()
    const list = id ? document.getElementById(id) : null
    return list ? Array.from(list.querySelectorAll('[role="option"]')) : []
  }

  /** What the reply chip reads, or undefined while the input is not in reply mode. */
  const chipText = () => {
    const clearButton = container.querySelector('[aria-label="Stop replying"]')
    return clearButton?.parentElement?.textContent ?? undefined
  }

  return {
    textarea,
    onSendChatMessage,
    emit,
    handle,
    caretAt,
    type,
    press,
    listId,
    options,
    chipText,
  }
}

describe('client/messaging/message-input', () => {
  beforeEach(() => {
    fakeProvider.match = undefined
    runChatCommand.mockReset()
    runChatCommand.mockImplementation((input: string) => ({ kind: 'text', text: input }))
    reply.target = undefined
    reply.sendReply.mockReset()
  })

  test('Enter takes the highlighted row when the rows are the only answers', () => {
    const { textarea, onSendChatMessage, type, press } = renderInput()
    claimLastWord(() => ({ suggestions: ROWS }))

    type('al')
    press('Enter')

    expect(textarea.value).toBe('alpha ')
    expect(onSendChatMessage).not.toHaveBeenCalled()
  })

  test('Tab takes the highlighted row', () => {
    const { textarea, type, press } = renderInput()
    claimLastWord(() => ({ suggestions: ROWS }))

    type('al')
    press('Tab')

    expect(textarea.value).toBe('alpha ')
  })

  test('Escape closes the palette and leaves Enter to send what was typed', () => {
    const { textarea, onSendChatMessage, type, press, listId } = renderInput()
    claimLastWord(() => ({ suggestions: ROWS }))

    type('al')
    expect(listId()).not.toBeNull()

    press('Escape')
    expect(listId()).toBeNull()

    press('Enter')
    expect(runChatCommand).toHaveBeenCalledWith('al', expect.anything())
    expect(onSendChatMessage).toHaveBeenCalledWith('al')
    expect(textarea.value).toBe('')
  })

  test('Enter sends what was typed once it spells the highlighted row out', () => {
    const { textarea, onSendChatMessage, type, press } = renderInput()
    claimLastWord(query => ({ suggestions: rowsMatching(query), submitOnExact: true }))

    type('alpha')
    press('Enter')

    expect(onSendChatMessage).toHaveBeenCalledWith('alpha')
    expect(textarea.value).toBe('')
  })

  test('Enter takes a row the typed text has not spelled out yet', () => {
    const { textarea, onSendChatMessage, type, press } = renderInput()
    claimLastWord(query => ({ suggestions: rowsMatching(query), submitOnExact: true }))

    type('alph')
    press('Enter')

    expect(textarea.value).toBe('alpha ')
    expect(onSendChatMessage).not.toHaveBeenCalled()
  })

  test('space takes the one row left over', () => {
    const { textarea, type, press } = renderInput()
    claimLastWord(query => ({ suggestions: rowsMatching(query), spaceAcceptsSingle: true }))

    type('alph')

    expect(press(' ')).toBe(false)
    expect(textarea.value).toBe('alpha ')
  })

  test('space is left to the browser while more than one row is offered', () => {
    const { textarea, type, press } = renderInput()
    claimLastWord(query => ({ suggestions: rowsMatching(query), spaceAcceptsSingle: true }))

    type('al')
    expect(rowsMatching('al')).toHaveLength(2)

    expect(press(' ')).toBe(true)
    expect(textarea.value).toBe('al')
  })

  test('space is left to the browser when the one row is already typed out', () => {
    const { textarea, type, press } = renderInput()
    claimLastWord(query => ({ suggestions: rowsMatching(query), spaceAcceptsSingle: true }))

    type('alpha')

    expect(press(' ')).toBe(true)
    expect(textarea.value).toBe('alpha')
  })

  test('space is left to the browser when the palette does not offer it', () => {
    const { textarea, type, press } = renderInput()
    claimLastWord(query => ({ suggestions: rowsMatching(query) }))

    type('alph')

    expect(press(' ')).toBe(true)
    expect(textarea.value).toBe('alph')
  })

  test('Enter sends what was typed when the rows are only offers', () => {
    const { textarea, onSendChatMessage, type, press } = renderInput()
    claimLastWord(query => ({
      suggestions: rowsMatching(query),
      submitOnExact: true,
      openEnded: true,
    }))

    type('alph')
    press('Enter')

    expect(onSendChatMessage).toHaveBeenCalledWith('alph')
    expect(textarea.value).toBe('')
  })

  test('an arrow key picks a row out of the offers, and Enter then takes it', () => {
    const { textarea, onSendChatMessage, type, press } = renderInput()
    claimLastWord(query => ({
      suggestions: rowsMatching(query),
      submitOnExact: true,
      openEnded: true,
    }))

    type('alph')
    press('ArrowDown')
    press('Enter')

    expect(textarea.value).toBe('alpha ')
    expect(onSendChatMessage).not.toHaveBeenCalled()
  })

  test('space never takes a row out of the offers', () => {
    const { textarea, type, press } = renderInput()
    claimLastWord(query => ({ suggestions: rowsMatching(query), openEnded: true }))

    type('alph')

    expect(press(' ')).toBe(true)
    expect(textarea.value).toBe('alph')
  })

  test('a palette that closes and reopens starts on its first row again', () => {
    const { textarea, type, press, listId, options } = renderInput()
    claimLastWord(query => ({ suggestions: query === 'zz' ? [] : ROWS }))

    type('al')
    const id = listId()!
    expect(options()).toHaveLength(3)

    press('ArrowDown')
    press('ArrowDown')
    expect(textarea.getAttribute('aria-activedescendant')).toBe(`${id}-2`)
    expect(options()[2].getAttribute('aria-selected')).toBe('true')

    // Nothing answers this, so the palette closes with the provider unchanged.
    type('zz')
    expect(listId()).toBeNull()

    type('al')
    expect(listId()).toBe(id)
    expect(textarea.getAttribute('aria-activedescendant')).toBe(`${id}-0`)
    expect(options()[0].getAttribute('aria-selected')).toBe('true')

    press('Enter')
    expect(textarea.value).toBe('alpha ')
  })

  test('rows that arrive after the caret has moved on are dropped', async () => {
    const { type, options } = renderInput()
    let deliverSlow: (rows: ReadonlyArray<TypeaheadSuggestion>) => void = () => {}
    const slow = new Promise<ReadonlyArray<TypeaheadSuggestion>>(resolve => {
      deliverSlow = resolve
    })
    claimLastWord(query => ({ suggestions: query === 'slow' ? slow : [row('fast')] }))

    type('slow')
    type('fast')

    expect(options()).toHaveLength(1)
    expect(options()[0].textContent).toContain('fast')

    await act(async () => {
      deliverSlow([row('stale')])
    })

    expect(options()).toHaveLength(1)
    expect(options()[0].textContent).toContain('fast')
  })

  test('the reply command locks the target it names as soon as it is typed', () => {
    const { textarea, type, chipText } = renderInput()
    reply.target = { id: makeSbUserId(2), name: 'tec27' }

    type('/r ')

    expect(chipText()).toContain('tec27')
    expect(textarea.value).toBe('')
  })

  test('a reply typed with its message in one go keeps the message', () => {
    const { textarea, type, chipText } = renderInput()
    reply.target = { id: makeSbUserId(2), name: 'tec27' }

    type('/r hello')

    expect(chipText()).toContain('tec27')
    expect(textarea.value).toBe('hello')
  })

  test('a reply with nobody to reply to says so and locks nothing', () => {
    const { textarea, emit, type, chipText } = renderInput()

    type('/r ')

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(emit.mock.calls[0][0].content).toContain('No one has whispered you')
    expect(chipText()).toBeUndefined()
    expect(textarea.value).toBe('')
  })

  test('taking the command out of the palette locks the target too', () => {
    const { textarea, type, press, chipText } = renderInput()
    reply.target = { id: makeSbUserId(2), name: 'tec27' }
    claimLastWord(() => ({
      suggestions: [
        {
          key: 'row:/reply',
          text: '/reply',
          visual: { kind: 'plain' },
          insertText: '/reply ',
          exact: false,
        },
      ],
    }))

    type('/r')
    press('Tab')

    expect(chipText()).toContain('tec27')
    expect(textarea.value).toBe('')
  })

  test('a whisper arriving mid-composition leaves the locked target alone', () => {
    const { type, press, chipText } = renderInput()
    reply.target = { id: makeSbUserId(2), name: 'tec27' }

    type('/r ')
    reply.target = { id: makeSbUserId(3), name: 'Marko' }
    type('hello')

    expect(chipText()).toContain('tec27')

    press('Enter')

    expect(reply.sendReply).toHaveBeenCalledWith(
      { id: makeSbUserId(2), name: 'tec27' },
      'hello',
      expect.anything(),
    )
  })

  test('Enter in reply mode whispers the target and drops back out of it', () => {
    const { textarea, onSendChatMessage, type, press, chipText } = renderInput()
    reply.target = { id: makeSbUserId(2), name: 'tec27' }

    type('/r hello')
    press('Enter')

    expect(reply.sendReply).toHaveBeenCalledWith(
      { id: makeSbUserId(2), name: 'tec27' },
      'hello',
      expect.anything(),
    )
    expect(onSendChatMessage).not.toHaveBeenCalled()
    expect(runChatCommand).not.toHaveBeenCalled()
    expect(textarea.value).toBe('')
    expect(chipText()).toBeUndefined()
  })

  test('in reply mode a leading slash is text, not a command palette', () => {
    // '/wh' is a real command-name query (it prefix-matches "whisper"), so this exercises the
    // actual command providers rather than the fake one standing in for the emote provider: it is
    // what a command palette would open on outside reply mode, and Enter would take the
    // highlighted row rather than send it, if commands were still on offer here.
    const { onSendChatMessage, listId, options, type, press } = renderInput()
    reply.target = { id: makeSbUserId(2), name: 'tec27' }

    type('/r ')
    type('/wh')

    expect(listId()).toBeNull()
    expect(options()).toHaveLength(0)

    press('Enter')

    expect(reply.sendReply).toHaveBeenCalledWith(
      { id: makeSbUserId(2), name: 'tec27' },
      '/wh',
      expect.anything(),
    )
    expect(runChatCommand).not.toHaveBeenCalled()
    expect(onSendChatMessage).not.toHaveBeenCalled()
  })

  test('entering reply mode from the handle closes an open palette', () => {
    const { type, listId, handle, chipText } = renderInput()
    claimLastWord(() => ({ suggestions: ROWS }))

    type('al')
    expect(listId()).not.toBeNull()

    act(() => {
      handle.current!.startReply({ id: makeSbUserId(2), name: 'tec27' })
    })

    expect(listId()).toBeNull()
    expect(chipText()).toContain('tec27')
  })

  test('Backspace at the very start of the text clears the chip and keeps the text', () => {
    const { textarea, type, press, caretAt, chipText } = renderInput()
    reply.target = { id: makeSbUserId(2), name: 'tec27' }

    type('/r hello')
    caretAt(0)

    expect(press('Backspace')).toBe(false)
    expect(chipText()).toBeUndefined()
    expect(textarea.value).toBe('hello')
  })

  test('Backspace anywhere else is left to the browser', () => {
    const { type, press, chipText } = renderInput()
    reply.target = { id: makeSbUserId(2), name: 'tec27' }

    type('/r hello')

    expect(press('Backspace')).toBe(true)
    expect(chipText()).toContain('tec27')
  })

  test('Escape clears the chip', () => {
    const { textarea, type, press, chipText } = renderInput()
    reply.target = { id: makeSbUserId(2), name: 'tec27' }

    type('/r hello')

    expect(press('Escape')).toBe(false)
    expect(chipText()).toBeUndefined()
    expect(textarea.value).toBe('hello')
  })

  test('the handle puts the input into reply mode, keeping what is typed', () => {
    const { textarea, handle, type, chipText } = renderInput()

    type('half a thought')
    act(() => {
      handle.current!.startReply({ id: makeSbUserId(2), name: 'tec27' })
    })

    expect(chipText()).toContain('tec27')
    expect(textarea.value).toBe('half a thought')
  })
})
