import { render, screen } from '@testing-library/react'
import { Provider as ReduxProvider } from 'react-redux'
import { describe, expect, test, vi } from 'vitest'
import { encodePrettyId } from '../../common/pretty-id'
import { makeSbUserId } from '../../common/users/sb-user-id'
import createStore from '../create-store'
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
  const store = createStore()
  const doRender = (text: string): HTMLElement => {
    render(
      <ReduxProvider store={store}>
        <div data-testid='message-container'>
          <TextMessage
            msgId='MESSAGE_ID'
            userId={userId}
            selfUserId={selfUserId}
            time={0}
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
})
