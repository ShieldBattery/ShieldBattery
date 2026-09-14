import { act, fireEvent, render } from '@testing-library/react'
import { Provider as ReduxProvider } from 'react-redux'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import createStore from '../create-store'
import { KeyListenerBoundary } from '../keyboard/key-listener'
import { CommandContext } from './commands/command-context'
import { MessageInput } from './message-input'
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
  const { container } = render(
    <ReduxProvider store={createStore()}>
      <KeyListenerBoundary>
        <MessageInput
          onSendChatMessage={onSendChatMessage}
          commands={{ context: commandContext, emit: () => {} }}
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

  return { textarea, onSendChatMessage, caretAt, type, press, listId, options }
}

describe('client/messaging/message-input', () => {
  beforeEach(() => {
    fakeProvider.match = undefined
    runChatCommand.mockReset()
    runChatCommand.mockImplementation((input: string) => ({ kind: 'text', text: input }))
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
})
