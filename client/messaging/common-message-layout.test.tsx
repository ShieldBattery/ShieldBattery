import { render, screen } from '@testing-library/react'
import { Provider as ReduxProvider } from 'react-redux'
import { describe, expect, test } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import createStore from '../create-store'
import { TextMessage } from './common-message-layout'

const selfUserId = makeSbUserId(1)
const userId = makeSbUserId(2)

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
})
