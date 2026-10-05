import { cleanup, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { Provider as ReduxProvider } from 'react-redux'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { encodePrettyId } from '../../common/pretty-id'
import { RolledOutcome } from '../../common/rolled-outcomes'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { channelInviteTokenFromMessageLink } from '../chat/channel-invite-card'
import createStore from '../create-store'
import { gameFromMessageLink, GameLinkTarget } from '../games/game-link-card'
import { LOBBY_INVITE_CARD_MAX_AGE_MS, lobbyIdFromMessageLink } from '../lobbies/lobby-invite-card'
import { NavigationAvailableContext } from '../navigation/navigation-available'
import { userFromMessageLink, UserLinkTarget } from '../users/user-card'
import { ChatContext } from './chat-context'
import { TextMessage, TextMessageLayout } from './common-message-layout'
import { DefaultMessageMenu } from './message-context-menu'

// The outcome line is built with `Trans`, which needs an i18next instance to render against.
// `escapeValue` matches how the app initializes i18next: React escapes what it renders, so escaping
// again would put entities on screen in place of the punctuation these lines are made of.
beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

vi.mock('../lobbies/lobby-invite-card', async importOriginal => {
  const actual = await importOriginal<typeof import('../lobbies/lobby-invite-card')>()
  return {
    ...actual,
    LobbyInviteCard: ({ lobbyId }: { lobbyId: string }) => (
      <div data-testid='lobby-invite-card'>{lobbyId}</div>
    ),
  }
})

vi.mock('../games/game-link-card', async importOriginal => {
  const actual = await importOriginal<typeof import('../games/game-link-card')>()
  return {
    ...actual,
    GameLinkCard: ({ target }: { target: GameLinkTarget }) => (
      <div data-testid='game-link-card'>{`${target.gameId} ${target.subPage ?? ''}`}</div>
    ),
  }
})

vi.mock('../chat/channel-invite-card', async importOriginal => {
  const actual = await importOriginal<typeof import('../chat/channel-invite-card')>()
  return {
    ...actual,
    ChannelInviteCard: ({ token }: { token: string }) => (
      <div data-testid='channel-invite-card'>{token}</div>
    ),
  }
})

vi.mock('../chat/channel-link-card', async importOriginal => {
  const actual = await importOriginal<typeof import('../chat/channel-link-card')>()
  return {
    ...actual,
    ChannelLinkCard: ({ channelId }: { channelId: number }) => (
      <div data-testid='channel-link-card'>{channelId}</div>
    ),
  }
})

vi.mock('../users/user-card', async importOriginal => {
  const actual = await importOriginal<typeof import('../users/user-card')>()
  return {
    ...actual,
    UserLinkCard: ({ target }: { target: UserLinkTarget }) => (
      <div data-testid='user-link-card'>{`${target.userId} ${target.subPage ?? ''}`}</div>
    ),
  }
})

const selfUserId = makeSbUserId(1)
const userId = makeSbUserId(2)
const LOBBY_ID = encodePrettyId('5eed0000-0000-0000-0000-000000000042')
const GAME_ID = '9a3e0000-0000-0000-0000-000000000077'
const ROUTE_GAME_ID = encodePrettyId(GAME_ID)

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
  const doRender = (
    text: string,
    {
      time = 0,
      emote,
      outcome,
      layout,
      navigationAvailable = true,
    }: {
      time?: number
      emote?: boolean
      outcome?: RolledOutcome
      layout?: TextMessageLayout
      navigationAvailable?: boolean
    } = {},
  ): HTMLElement => {
    render(
      <ReduxProvider store={store}>
        <NavigationAvailableContext.Provider value={navigationAvailable}>
          <div data-testid='message-container'>
            <TextMessage
              msgId='MESSAGE_ID'
              userId={userId}
              selfUserId={selfUserId}
              time={time}
              text={text}
              emote={emote}
              outcome={outcome}
              layout={layout}
            />
          </div>
        </NavigationAvailableContext.Provider>
      </ReduxProvider>,
    )
    return screen.getByTestId('message-container')
  }

  test('message as a normal text', () => {
    expect(doRender('This is test message')).toMatchSnapshot()
  })

  test('message sent as an emote reads as an action line', () => {
    const container = doRender('waves at everyone', { emote: true })

    // The name is still loading in this store, so the glyph and its space are what precede it.
    expect(container.textContent).toContain('* ')
    expect(container.textContent).not.toContain(': ')
    expect(container).toMatchSnapshot()
  })

  test('an emote message with no outcome renders no outcome chip', () => {
    // Text that reads like a roll but was typed by hand (`/me rolls 100`) must never pick up the
    // chip that a server-settled result gets: only `outcome` being set does that.
    const container = doRender('rolls 100', { emote: true })

    expect(screen.queryByTestId('outcome-chip')).toBeNull()
    expect(container.textContent).toContain('* ')
  })

  test('a roll outcome reads as an action line with the settled value in a chip', () => {
    const container = doRender('', { emote: true, outcome: { kind: 'roll', max: 100, value: 42 } })

    expect(container.textContent).toContain('* ')
    expect(container.textContent).toContain('rolls')
    expect(container.textContent).toContain('(1-100)')
    const chip = screen.getByTestId('outcome-chip')
    expect(chip.textContent).toBe('42')
  })

  test('a flip outcome reads the settled side in a chip', () => {
    const container = doRender('', { emote: true, outcome: { kind: 'flip', result: 'heads' } })

    expect(container.textContent).toContain('flips a coin')
    const chip = screen.getByTestId('outcome-chip')
    expect(chip.textContent).toBe('heads')
  })

  test('an eight-ball outcome reads the question and the settled answer in a chip', () => {
    const container = doRender('will it merge?', {
      emote: true,
      outcome: { kind: 'eightBall', answer: 'yesDefinitely' },
    })

    expect(container.textContent).toContain('asks the 8-ball')
    expect(container.textContent).toContain('will it merge?')
    const chip = screen.getByTestId('outcome-chip')
    expect(chip.textContent).toBe('Yes, definitely')
  })

  // The question is user text: nothing typed there may become an element, and i18next's own
  // `{{placeholder}}` and `$t()` syntax must come out as the characters the user typed.
  test('markup and placeholders typed into an eight-ball question stay literal text', () => {
    const question =
      '<strong>will I win</strong>? <br> <p>x</p> <i>y</i> 1<2 {{answer}} $t(chat.outcomes.flip.heads)'
    const container = doRender(question, {
      emote: true,
      outcome: { kind: 'eightBall', answer: 'yes' },
    })

    expect(container.querySelector('strong, p, br')).toBeNull()
    expect(Array.from(container.querySelectorAll('i')).some(el => el.textContent === 'y')).toBe(
      false,
    )
    expect(container.textContent).toContain(question)
    const chip = screen.getByTestId('outcome-chip')
    expect(chip.textContent).toBe('Yes')
  })

  test.each<TextMessageLayout>(['classic', 'cozyHeader'])(
    'a name badge renders beside the author name and not on mentions (%s)',
    layout => {
      render(
        <ReduxProvider store={store}>
          <ChatContext.Provider
            value={{
              MessageMenu: DefaultMessageMenu,
              NameBadge: ({ userId: badgedUserId }) => (
                <span data-testid='name-badge'>{`badge:${badgedUserId}`}</span>
              ),
            }}>
            <div data-testid='message-container'>
              <TextMessage
                msgId='MESSAGE_ID'
                userId={userId}
                selfUserId={selfUserId}
                time={0}
                text='hey <@123>'
                layout={layout}
              />
            </div>
          </ChatContext.Provider>
        </ReduxProvider>,
      )

      const badges = screen.getAllByTestId('name-badge')
      expect(badges).toHaveLength(1)
      expect(badges[0].textContent).toBe(`badge:${userId}`)
    },
  )

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

  test('no link cards render where navigation is unavailable', () => {
    const text =
      `https://shieldbattery.net/lobbies/${LOBBY_ID}/my-cool-lobby ` +
      `https://shieldbattery.net/games/${ROUTE_GAME_ID} ` +
      'https://shieldbattery.net/users/42/tec27 ' +
      `https://shieldbattery.net/chat/invite/${encodePrettyId('5eed0000-0000-4000-8000-000000000001')}`
    const cardTestIds = [
      'lobby-invite-card',
      'game-link-card',
      'user-link-card',
      'channel-invite-card',
    ]

    doRender(text)
    for (const testId of cardTestIds) {
      expect(screen.getAllByTestId(testId)).toHaveLength(1)
    }
    cleanup()

    doRender(text, { navigationAvailable: false })
    for (const testId of cardTestIds) {
      expect(screen.queryByTestId(testId)).toBeNull()
    }
  })

  describe('cozy layouts', () => {
    test('header with plain text', () => {
      expect(doRender('This is test message', { layout: 'cozyHeader' })).toMatchSnapshot()
    })

    test('continuation with plain text', () => {
      expect(doRender('This is test message', { layout: 'cozyContinuation' })).toMatchSnapshot()
    })

    test('header whose text mentions the self user', () => {
      expect(doRender('Hey <@1>', { layout: 'cozyHeader' })).toMatchSnapshot()
    })

    test('header with a message-link chip', () => {
      expect(
        doRender(
          'see this: https://shieldbattery.net/chat/1/some-channel?m=9b2e8d0e-5f3a-4a2b-8c1d-6f5e4d3c2b1a',
          { layout: 'cozyHeader' },
        ),
      ).toMatchSnapshot()
    })

    test('continuation with an emoji-only message', () => {
      expect(doRender('🔥🔥 🎉', { layout: 'cozyContinuation' })).toMatchSnapshot()
    })

    test('an action line ignores a cozy layout', () => {
      const cozy = doRender('waves at everyone', { emote: true, layout: 'cozyHeader' }).innerHTML
      cleanup()
      const classic = doRender('waves at everyone', { emote: true }).innerHTML

      expect(cozy).toBe(classic)
    })
  })

  describe('game links', () => {
    test('a game results link resolves to its game and tab', () => {
      expect(
        gameFromMessageLink(`https://shieldbattery.net/games/${ROUTE_GAME_ID}/build-orders`),
      ).toEqual({ gameId: GAME_ID, subPage: 'build-orders' })
      expect(gameFromMessageLink(`https://shieldbattery.net/games/${ROUTE_GAME_ID}`)).toEqual({
        gameId: GAME_ID,
        subPage: undefined,
      })
    })

    test('non-game ShieldBattery paths resolve to no game', () => {
      expect(gameFromMessageLink('https://shieldbattery.net/games/')).toBeUndefined()
      expect(gameFromMessageLink('https://shieldbattery.net/games/not-a-game-id')).toBeUndefined()
      expect(
        gameFromMessageLink(`https://shieldbattery.net/games/${ROUTE_GAME_ID}/summary/extra`),
      ).toBeUndefined()
    })

    test('message with a game link renders exactly one game card', () => {
      doRender(`gg: https://shieldbattery.net/games/${ROUTE_GAME_ID}/summary`)
      expect(screen.getByTestId('game-link-card').textContent).toBe(`${GAME_ID} summary`)
    })

    test('message with multiple game links renders only one game card', () => {
      doRender(
        `https://shieldbattery.net/games/${ROUTE_GAME_ID} and ` +
          `https://shieldbattery.net/games/${encodePrettyId('9a3e0000-0000-0000-0000-000000000078')}`,
      )
      expect(screen.getAllByTestId('game-link-card')).toHaveLength(1)
    })

    test('game-shaped path on a foreign origin renders no game card', () => {
      doRender(`https://example.com/games/${ROUTE_GAME_ID}`)
      expect(screen.queryByTestId('game-link-card')).toBeNull()
    })

    test('a game link and a lobby link in one message render both cards', () => {
      doRender(
        `https://shieldbattery.net/games/${ROUTE_GAME_ID} rematch? ` +
          `https://shieldbattery.net/lobbies/${LOBBY_ID}/my-cool-lobby`,
      )
      expect(screen.getAllByTestId('game-link-card')).toHaveLength(1)
      expect(screen.getAllByTestId('lobby-invite-card')).toHaveLength(1)
      expect(
        screen.getByRole('link', { name: `https://shieldbattery.net/games/${ROUTE_GAME_ID}` }),
      ).toBeTruthy()
    })

    test('an old game link still renders its game card', () => {
      doRender(`https://shieldbattery.net/games/${ROUTE_GAME_ID}`, {
        time: -(LOBBY_INVITE_CARD_MAX_AGE_MS + 1),
      })
      expect(screen.getAllByTestId('game-link-card')).toHaveLength(1)
    })
  })

  describe('profile links', () => {
    test('a profile link resolves to its user and tab', () => {
      expect(userFromMessageLink('https://shieldbattery.net/users/42/tec27/match-history')).toEqual(
        { userId: makeSbUserId(42), subPage: 'match-history' },
      )
      expect(userFromMessageLink('https://shieldbattery.net/users/42/tec27')).toEqual({
        userId: makeSbUserId(42),
        subPage: undefined,
      })
    })

    test('non-profile ShieldBattery paths resolve to no user', () => {
      expect(userFromMessageLink('https://shieldbattery.net/users/42')).toBeUndefined()
      expect(userFromMessageLink('https://shieldbattery.net/users/tec27/42')).toBeUndefined()
      expect(userFromMessageLink('https://shieldbattery.net/users/0/nobody')).toBeUndefined()
      expect(
        userFromMessageLink('https://shieldbattery.net/users/42/tec27/summary/extra'),
      ).toBeUndefined()
    })

    test('message with a profile link renders exactly one user card', () => {
      doRender('check him out https://shieldbattery.net/users/42/tec27/match-history')
      expect(screen.getByTestId('user-link-card').textContent).toBe('42 match-history')
    })

    test('message with multiple profile links renders only one user card', () => {
      doRender(
        'https://shieldbattery.net/users/42/tec27 vs https://shieldbattery.net/users/43/pachi',
      )
      expect(screen.getAllByTestId('user-link-card')).toHaveLength(1)
    })

    test('profile-shaped path on a foreign origin renders no user card', () => {
      doRender('https://example.com/users/42/tec27')
      expect(screen.queryByTestId('user-link-card')).toBeNull()
    })
  })

  describe('channel invite links', () => {
    const INVITE_TOKEN = encodePrettyId('5eed0000-0000-4000-8000-000000000001')

    test('an invite link resolves to its token', () => {
      expect(
        channelInviteTokenFromMessageLink(`https://shieldbattery.net/chat/invite/${INVITE_TOKEN}`),
      ).toBe(INVITE_TOKEN)
    })

    test('non-invite ShieldBattery paths resolve to no token', () => {
      expect(
        channelInviteTokenFromMessageLink('https://shieldbattery.net/chat/invite/'),
      ).toBeUndefined()
      expect(
        channelInviteTokenFromMessageLink('https://shieldbattery.net/chat/invite/not-a-token'),
      ).toBeUndefined()
      expect(
        channelInviteTokenFromMessageLink(
          `https://shieldbattery.net/chat/invite/${INVITE_TOKEN}/extra`,
        ),
      ).toBeUndefined()
      expect(
        channelInviteTokenFromMessageLink('https://shieldbattery.net/chat/7/invite'),
      ).toBeUndefined()
    })

    test('message with an invite link renders exactly one invite card and keeps the link', () => {
      const link = `https://shieldbattery.net/chat/invite/${INVITE_TOKEN}`
      doRender(`come hang out: ${link}`)

      expect(screen.getByTestId('channel-invite-card').textContent).toBe(INVITE_TOKEN)
      expect(screen.getByRole('link', { name: link })).toBeTruthy()
    })

    test('message with multiple invite links renders only one invite card', () => {
      const otherToken = encodePrettyId('5eed0000-0000-4000-8000-000000000002')
      doRender(
        `https://shieldbattery.net/chat/invite/${INVITE_TOKEN} or ` +
          `https://shieldbattery.net/chat/invite/${otherToken}`,
      )

      expect(screen.getAllByTestId('channel-invite-card')).toHaveLength(1)
      expect(screen.getByTestId('channel-invite-card').textContent).toBe(INVITE_TOKEN)
    })

    test('invite-shaped path on a foreign origin renders no invite card', () => {
      doRender(`https://example.com/chat/invite/${INVITE_TOKEN}`)
      expect(screen.queryByTestId('channel-invite-card')).toBeNull()
    })

    test('an invite link renders no other kind of link card', () => {
      doRender(`https://shieldbattery.net/chat/invite/${INVITE_TOKEN}`)
      expect(screen.queryByTestId('lobby-invite-card')).toBeNull()
      expect(screen.queryByTestId('game-link-card')).toBeNull()
      expect(screen.queryByTestId('user-link-card')).toBeNull()
    })
  })

  describe('channel links', () => {
    test('message with a channel link renders exactly one channel card and keeps the link', () => {
      const link = 'https://shieldbattery.net/chat/7/ShieldBattery'
      doRender(`come hang out: ${link}`)

      expect(screen.getByTestId('channel-link-card').textContent).toBe('7')
      expect(screen.getByRole('link', { name: link })).toBeTruthy()
    })

    test('a channel link with a stale name segment renders the card for its id', () => {
      doRender('https://shieldbattery.net/chat/7/_')
      expect(screen.getByTestId('channel-link-card').textContent).toBe('7')
    })

    test('message with multiple channel links renders only one channel card', () => {
      doRender('https://shieldbattery.net/chat/7/a or https://shieldbattery.net/chat/8/b')

      expect(screen.getAllByTestId('channel-link-card')).toHaveLength(1)
      expect(screen.getByTestId('channel-link-card').textContent).toBe('7')
    })

    test('a channel message link renders a chip and no channel card', () => {
      doRender(
        'https://shieldbattery.net/chat/7/ShieldBattery?m=9b2e8d0e-5f3a-4a2b-8c1d-6f5e4d3c2b1a',
      )
      expect(screen.queryByTestId('channel-link-card')).toBeNull()
      expect(screen.getByRole('link').textContent).toContain('message')
    })

    test('an invite link renders no channel card', () => {
      doRender(
        `https://shieldbattery.net/chat/invite/${encodePrettyId('5eed0000-0000-4000-8000-000000000001')}`,
      )
      expect(screen.queryByTestId('channel-link-card')).toBeNull()
    })

    test('a channel-shaped path on a foreign origin renders no channel card', () => {
      doRender('https://example.com/chat/7/ShieldBattery')
      expect(screen.queryByTestId('channel-link-card')).toBeNull()
    })

    test('a channel link renders no card where navigation is unavailable', () => {
      doRender('https://shieldbattery.net/chat/7/ShieldBattery', { navigationAvailable: false })
      expect(screen.queryByTestId('channel-link-card')).toBeNull()
    })

    test('a channel link renders no other kind of link card', () => {
      doRender('https://shieldbattery.net/chat/7/ShieldBattery')
      expect(screen.queryByTestId('lobby-invite-card')).toBeNull()
      expect(screen.queryByTestId('game-link-card')).toBeNull()
      expect(screen.queryByTestId('user-link-card')).toBeNull()
      expect(screen.queryByTestId('channel-invite-card')).toBeNull()
    })
  })

  describe('message links', () => {
    const MESSAGE_ID = '9b2e8d0e-5f3a-4a2b-8c1d-6f5e4d3c2b1a'

    test('a ShieldBattery channel message link renders as a channel/message label', () => {
      doRender(`see this: https://shieldbattery.net/chat/1/some-channel?m=${MESSAGE_ID}`)
      const link = screen.getByRole('link')

      expect(link.getAttribute('href')).toBe(
        `https://shieldbattery.net/chat/1/some-channel?m=${MESSAGE_ID}`,
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
      doRender(`https://example.com/chat/1/x?m=${MESSAGE_ID}`)
      const link = screen.getByRole('link')

      expect(link.textContent).toBe(`https://example.com/chat/1/x?m=${MESSAGE_ID}`)
    })

    test('a ShieldBattery whisper message link renders as a generic whisper/message label', () => {
      doRender(`see this: https://shieldbattery.net/whispers/m/${MESSAGE_ID}`)
      const link = screen.getByRole('link')

      expect(link.getAttribute('href')).toBe(`https://shieldbattery.net/whispers/m/${MESSAGE_ID}`)
      expect(link.textContent).not.toContain('shieldbattery.net')
      expect(link.textContent).toContain('Whisper')
      expect(link.textContent).toContain('message')
    })

    test('a resolved (viewer-relative) whisper URL renders as a plain link', () => {
      // Unlike the message-link form above, this URL is relative to whichever participant it was
      // built for, so it can't be shown as a shareable chip to a reader it wasn't built for.
      doRender(`https://shieldbattery.net/whispers/7/someone?m=${MESSAGE_ID}`)
      const link = screen.getByRole('link')

      expect(link.textContent).toBe(`https://shieldbattery.net/whispers/7/someone?m=${MESSAGE_ID}`)
    })
  })
})
