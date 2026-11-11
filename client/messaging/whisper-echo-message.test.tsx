import { render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { Provider as ReduxProvider } from 'react-redux'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user-id'
import createStore from '../create-store'
import { shortTimestamp } from '../i18n/date-formats'
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

// The real `ConnectedUsername` reaches for user info and opens overlays of its own, neither of
// which these tests are about.
const { userNames } = vi.hoisted(() => ({ userNames: new Map<number, string>() }))

vi.mock('../users/connected-username', () => ({
  ConnectedUsername: ({ userId, className }: { userId: number; className?: string }) => (
    <span className={className}>{userNames.get(userId)}</span>
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

function doRender(message: CommonWhisperEchoMessage): HTMLElement {
  const store = createStore()
  seedUsers(store, [{ id: message.counterpartId }])

  render(
    <ReduxProvider store={store}>
      <WhisperEchoMessage message={message} />
    </ReduxProvider>,
  )

  return screen.getByTestId('whisper-echo')
}

describe('client/messaging/whisper-echo-message', () => {
  test('an incoming whisper is labelled with who it is from', () => {
    const line = doRender(makeEcho({ direction: 'incoming' }))

    expect(line.textContent).toBe(
      `[${shortTimestamp.current().format(SENT_TIME)}] From: ${COUNTERPART_NAME}: how goes it`,
    )
  })

  test('an outgoing whisper is labelled with who it is to', () => {
    const line = doRender(makeEcho({ direction: 'outgoing' }))

    expect(line.textContent).toBe(
      `[${shortTimestamp.current().format(SENT_TIME)}] To: ${COUNTERPART_NAME}: how goes it`,
    )
  })

  test('a whisper sent as an emote reads as an action line', () => {
    const line = doRender(makeEcho({ direction: 'incoming', emote: true, text: 'waves' }))

    expect(line.textContent).toBe(
      `[${shortTimestamp.current().format(SENT_TIME)}] From: * ${COUNTERPART_NAME} waves`,
    )
    expect(line.textContent).not.toContain(`${COUNTERPART_NAME}:`)
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
      `[${shortTimestamp.current().format(SENT_TIME)}] From: * ${COUNTERPART_NAME} rolls 42 (1-100)`,
    )
    expect(screen.getByTestId('outcome-chip').textContent).toBe('42')
  })
})
