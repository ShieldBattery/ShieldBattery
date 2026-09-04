import { render, screen } from '@testing-library/react'
import { Provider as ReduxProvider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { encodePrettyId } from '../../common/pretty-id'
import { makeSbUserId } from '../../common/users/sb-user-id'
import createStore from '../create-store'
import { LOBBY_INVITE_CARD_MAX_AGE_MS, lobbyIdFromMessageLink } from '../lobbies/lobby-invite-card'
import { TextMessage } from './common-message-layout'

vi.mock('../lobbies/lobby-invite-card', async importOriginal => {
  const actual = await importOriginal<typeof import('../lobbies/lobby-invite-card')>()
  return {
    ...actual,
    LobbyInviteCard: ({ lobbyId }: { lobbyId: string }) => (
      <div data-testid='lobby-invite-card'>{lobbyId}</div>
    ),
  }
})

const selfUserId = makeSbUserId(1)
const userId = makeSbUserId(2)
const LOBBY_ID = encodePrettyId('5eed0000-0000-0000-0000-000000000042')

describe('client/messaging/common-message-layout/TextMessage', () => {
  beforeEach(() => {
    // The invite-card age gate compares the message time against the current time; pinning the
    // clock to 0 makes the fixed `time={0}` used across these tests read as "just sent"
    vi.spyOn(Date, 'now').mockReturnValue(0)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const store = createStore()
  const doRender = (text: string, { time = 0 }: { time?: number } = {}): HTMLElement => {
    render(
      <ReduxProvider store={store}>
        <div data-testid='message-container'>
          <TextMessage
            msgId='MESSAGE_ID'
            userId={userId}
            selfUserId={selfUserId}
            time={time}
            text={text}
          />
        </div>
      </ReduxProvider>,
    )
    return screen.getByTestId('message-container')
  }

  test('message as a normal text', () => {
    expect(doRender('This is test message')).toMatchSnapshot()
  })

  test('message with a link', () => {
    expect(doRender('here is a link http://www.example.com')).toMatchSnapshot()
  })

  test('message with a mention', () => {
    expect(doRender('hey <@123>')).toMatchSnapshot()
  })

  test('message with a link before a mention', () => {
    expect(doRender('http://www.example.com go here <@123>')).toMatchSnapshot()
  })

  test('message with a link between mentions', () => {
    expect(doRender('hey <@123> see http://www.example.com go here <@123>')).toMatchSnapshot()
  })

  test('message with a mention before a link', () => {
    expect(doRender('<@123> go to http://www.example.com')).toMatchSnapshot()
  })

  test('message with a mention between links', () => {
    expect(
      doRender('http://www.example.com go here <@123> or here http://www.example.com'),
    ).toMatchSnapshot()
  })

  test('message with a mention of self user', () => {
    expect(doRender('Hey <@1>')).toMatchSnapshot()
  })

  test('message with only emoji renders them jumbo-sized', () => {
    expect(doRender('🔥🔥 🎉')).toMatchSnapshot()
  })

  test('message mixing emoji and text renders them inline-sized', () => {
    expect(doRender('nice game 🔥')).toMatchSnapshot()
  })

  test('message with too many emoji for jumbo stays inline-sized', () => {
    expect(doRender('😀😀😀😀😀😀😀😀😀😀😀')).toMatchSnapshot()
  })

  // Canary for the invite-card tests below: card rendering depends on lobby-link detection, which
  // compares a link's origin against the server origin assembled from the test environment
  // (IS_ELECTRON global + the SB_SERVER define, via `baseUrl`). If this test fails alongside the
  // card tests, that environment chain broke (or drifted in vitest config) — the component's card
  // gating is not at fault. If the card tests fail while this passes, suspect the component.
  test('lobby-link detection resolves ids against the test server origin', () => {
    expect(
      lobbyIdFromMessageLink(`https://shieldbattery.net/lobbies/${LOBBY_ID}/my-cool-lobby`),
    ).toBe(LOBBY_ID)
  })

  test('message with a lobby link renders exactly one invite card', () => {
    doRender(`join me: https://shieldbattery.net/lobbies/${LOBBY_ID}/my-cool-lobby`)
    expect(screen.getAllByTestId('lobby-invite-card')).toHaveLength(1)
  })

  test('message with a non-lobby link renders no invite card', () => {
    doRender('here is a link http://www.example.com')
    expect(screen.queryByTestId('lobby-invite-card')).toBeNull()
  })

  test('lobby-shaped path on a foreign origin renders no invite card', () => {
    doRender(`https://example.com/lobbies/${LOBBY_ID}/my-cool-lobby`)
    expect(screen.queryByTestId('lobby-invite-card')).toBeNull()
  })

  test('message with multiple lobby links renders only one invite card', () => {
    doRender(
      `https://shieldbattery.net/lobbies/${LOBBY_ID} or ` +
        `https://shieldbattery.net/lobbies/${LOBBY_ID}/other-slug`,
    )
    expect(screen.getAllByTestId('lobby-invite-card')).toHaveLength(1)
  })

  test('message older than the invite-card age limit renders no invite card', () => {
    doRender(`join me: https://shieldbattery.net/lobbies/${LOBBY_ID}/my-cool-lobby`, {
      time: -(LOBBY_INVITE_CARD_MAX_AGE_MS + 1),
    })
    expect(screen.queryByTestId('lobby-invite-card')).toBeNull()
  })

  describe('channel message links', () => {
    const CHANNEL_MESSAGE_ID = '9b2e8d0e-5f3a-4a2b-8c1d-6f5e4d3c2b1a'

    test('a ShieldBattery channel message link renders as a channel/message label', () => {
      doRender(`see this: https://shieldbattery.net/chat/1/some-channel?m=${CHANNEL_MESSAGE_ID}`)
      const link = screen.getByRole('link')

      expect(link.getAttribute('href')).toBe(
        `https://shieldbattery.net/chat/1/some-channel?m=${CHANNEL_MESSAGE_ID}`,
      )
      expect(link.textContent).not.toContain('shieldbattery.net')
      expect(link.textContent).not.toContain('https://')
      // MaterialIcon renders its icon name as text content ('chat'), so this checks for the
      // translated label rather than asserting exact equality on the chip's full text.
      expect(link.textContent).toContain('message')
    })

    test('a same-origin chat URL without a valid message param renders as a plain link', () => {
      doRender('https://shieldbattery.net/chat/1/some-channel')
      const link = screen.getByRole('link')

      expect(link.textContent).toBe('https://shieldbattery.net/chat/1/some-channel')
    })

    test('a foreign-origin chat-shaped URL renders as a plain link', () => {
      doRender(`https://example.com/chat/1/x?m=${CHANNEL_MESSAGE_ID}`)
      const link = screen.getByRole('link')

      expect(link.textContent).toBe(`https://example.com/chat/1/x?m=${CHANNEL_MESSAGE_ID}`)
    })
  })
})
