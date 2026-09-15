import { fireEvent, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { Provider as ReduxProvider } from 'react-redux'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user-id'
import createStore from '../create-store'
import { shortTimestamp } from '../i18n/date-formats'
import { navigateToWhisper } from '../whispers/action-creators'
import { CommonMessageType, CommonWhisperEchoMessage } from './message-records'
import { WhisperEchoMessage } from './whisper-echo-message'

// The outcome line is built with `Trans`, which needs an i18next instance to render against.
// `escapeValue` matches how the app initializes i18next: React escapes what it renders, so escaping
// again would put entities on screen in place of the punctuation these lines are made of.
beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

// Only the navigation the line performs is stubbed; the rest of the module stays real, since the
// component imports it for that one function.
vi.mock('../whispers/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../whispers/action-creators')>()),
  navigateToWhisper: vi.fn(),
}))

// The real `ConnectedUsername` reaches for user info and opens overlays of its own, neither of
// which these tests are about. The stand-in keeps the one thing the line's click handling depends
// on: a focusable element, which is how the line tells a click on the name from a click on itself.
const { userNames } = vi.hoisted(() => ({ userNames: new Map<number, string>() }))

vi.mock('../users/connected-username', () => ({
  ConnectedUsername: ({ userId, className }: { userId: number; className?: string }) => (
    <span className={className} tabIndex={0}>
      {userNames.get(userId)}
    </span>
  ),
}))

const COUNTERPART_ID = makeSbUserId(2)
const COUNTERPART_NAME = 'tec27'
const SENT_TIME = new Date('2026-09-15T12:34:56Z').getTime()

userNames.set(COUNTERPART_ID, COUNTERPART_NAME)

function makeEcho(
  fields: Partial<CommonWhisperEchoMessage> & Pick<CommonWhisperEchoMessage, 'direction'>,
): CommonWhisperEchoMessage {
  return {
    id: 'ECHO_ID',
    type: CommonMessageType.WhisperEcho,
    time: SENT_TIME,
    counterpartId: COUNTERPART_ID,
    text: 'how goes it',
    ...fields,
  }
}

function seedUsers(store: ReturnType<typeof createStore>, users: Array<{ id: SbUserId }>) {
  store.dispatch({
    type: '@users/loadUsers',
    payload: users.map(({ id }) => ({ id, name: userNames.get(id)!, created: 0 })),
  })
}

function doRender(
  message: CommonWhisperEchoMessage,
  { withUser = true }: { withUser?: boolean } = {},
): HTMLElement {
  const store = createStore()
  if (withUser) {
    seedUsers(store, [{ id: message.counterpartId }])
  }

  render(
    <ReduxProvider store={store}>
      <WhisperEchoMessage message={message} />
    </ReduxProvider>,
  )

  return screen.getByTestId('whisper-echo')
}

describe('client/messaging/whisper-echo-message', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('an incoming whisper reads as an arrow towards the user', () => {
    const line = doRender(makeEcho({ direction: 'incoming' }))

    expect(line.textContent).toBe(
      `[${shortTimestamp.format(SENT_TIME)}] ← ${COUNTERPART_NAME}: how goes it`,
    )
  })

  test('an outgoing whisper reads as an arrow away from the user', () => {
    const line = doRender(makeEcho({ direction: 'outgoing' }))

    expect(line.textContent).toBe(
      `[${shortTimestamp.format(SENT_TIME)}] → ${COUNTERPART_NAME}: how goes it`,
    )
  })

  test('a whisper sent as an emote reads as an action line', () => {
    const line = doRender(makeEcho({ direction: 'incoming', emote: true, text: 'waves' }))

    expect(line.textContent).toBe(
      `[${shortTimestamp.format(SENT_TIME)}] ← * ${COUNTERPART_NAME} waves`,
    )
    expect(line.textContent).not.toContain(': ')
  })

  test('an echoed roll outcome reads as an action line with the settled value in a chip', () => {
    const line = doRender(
      makeEcho({
        direction: 'incoming',
        emote: true,
        text: '',
        outcome: { kind: 'roll', max: 100, value: 42 },
      }),
    )

    expect(line.textContent).toBe(
      `[${shortTimestamp.format(SENT_TIME)}] ← * ${COUNTERPART_NAME} rolls 42 (1-100)`,
    )
    expect(screen.getByTestId('outcome-chip').textContent).toBe('42')
  })

  test('clicking the line opens the conversation it came from', () => {
    const line = doRender(makeEcho({ direction: 'incoming' }))

    fireEvent.click(line)

    expect(navigateToWhisper).toHaveBeenCalledWith(COUNTERPART_ID, COUNTERPART_NAME)
  })

  test('clicking the name leaves the navigation to the name itself', () => {
    doRender(makeEcho({ direction: 'incoming' }))

    fireEvent.click(screen.getByText(COUNTERPART_NAME))

    expect(navigateToWhisper).not.toHaveBeenCalled()
  })

  test('a click that ends a selection does not navigate', () => {
    const line = doRender(makeEcho({ direction: 'incoming' }))
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection)

    fireEvent.click(line)

    expect(navigateToWhisper).not.toHaveBeenCalled()
  })

  test('a counterpart the client has no name for yet has nowhere to navigate to', () => {
    const line = doRender(makeEcho({ direction: 'incoming' }), { withUser: false })

    fireEvent.click(line)

    expect(navigateToWhisper).not.toHaveBeenCalled()
  })
})
