import React from 'react'
import ShallowRenderer from 'react-test-renderer/shallow'
import { SbUserId } from '../../common/users/user-info'
import { TextMessage } from './common-message-layout'

describe('client/messaging/common-message-layout/TextMessage', () => {
  test('message as a normal text', () => {
    const renderer = ShallowRenderer.createRenderer()
    renderer.render(
      <TextMessage
        userId={2 as SbUserId}
        selfUserId={1 as SbUserId}
        time={0}
        text={'This is test message'}
      />,
    )
    const result = renderer.getRenderOutput()

    expect(result).toMatchInlineSnapshot(`
      <TimestampMessageLayout
        highlighted={false}
        time={0}
      >
        <common-message-layout__Username>
          <ConnectedUsername
            userId={2}
          />
        </common-message-layout__Username>
        <message-layout__Separator
          aria-hidden={true}
        >
          : 
        </message-layout__Separator>
        <common-message-layout__Text>
          This is test message
        </common-message-layout__Text>
      </TimestampMessageLayout>
    `)
  })
})
