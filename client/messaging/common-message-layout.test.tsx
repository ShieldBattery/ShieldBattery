import React from 'react'
import ShallowRenderer from 'react-test-renderer/shallow'
import { makeSbUserId } from '../../common/users/user-info'
import { TextMessage } from './common-message-layout'

const selfUserId = makeSbUserId(1)
const userId = makeSbUserId(2)

describe('client/messaging/common-message-layout/TextMessage', () => {
  const renderer = ShallowRenderer.createRenderer()
  const doRender = (text: string): React.ReactElement => {
    renderer.render(<TextMessage userId={userId} selfUserId={selfUserId} time={0} text={text} />)
    return renderer.getRenderOutput()
  }

  test('message as a normal text', () => {
    expect(doRender('This is test message')).toMatchInlineSnapshot(`
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

  test('message with a link', () => {
    expect(doRender('here is a link http://www.example.com')).toMatchInlineSnapshot(`
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
          here is a link 
          <ExternalLink
            href="http://www.example.com"
          >
            http://www.example.com
          </ExternalLink>
        </common-message-layout__Text>
      </TimestampMessageLayout>
    `)
  })

  test('message with a mention', () => {
    expect(doRender('hey <@123>')).toMatchInlineSnapshot(`
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
          hey
           
          <common-message-layout__MentionedUsername
            prefix="@"
            userId={123}
          />
        </common-message-layout__Text>
      </TimestampMessageLayout>
    `)
  })

  test('message with a link before a mention', () => {
    expect(doRender('http://www.example.com go here <@123>')).toMatchInlineSnapshot(`
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
          <ExternalLink
            href="http://www.example.com"
          >
            http://www.example.com
          </ExternalLink>
           go here
           
          <common-message-layout__MentionedUsername
            prefix="@"
            userId={123}
          />
        </common-message-layout__Text>
      </TimestampMessageLayout>
    `)
  })

  test('message with a link between mentions', () => {
    expect(doRender('hey <@123> see http://www.example.com go here <@123>')).toMatchInlineSnapshot(`
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
          hey
           
          <common-message-layout__MentionedUsername
            prefix="@"
            userId={123}
          />
           see 
          <ExternalLink
            href="http://www.example.com"
          >
            http://www.example.com
          </ExternalLink>
           go here
           
          <common-message-layout__MentionedUsername
            prefix="@"
            userId={123}
          />
        </common-message-layout__Text>
      </TimestampMessageLayout>
    `)
  })

  test('message with a mention before a link', () => {
    expect(doRender('<@123> go to http://www.example.com')).toMatchInlineSnapshot(`
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
          
          <common-message-layout__MentionedUsername
            prefix="@"
            userId={123}
          />
           go to 
          <ExternalLink
            href="http://www.example.com"
          >
            http://www.example.com
          </ExternalLink>
        </common-message-layout__Text>
      </TimestampMessageLayout>
    `)
  })

  test('message with a mention between links', () => {
    expect(doRender('http://www.example.com go here <@123> or here http://www.example.com'))
      .toMatchInlineSnapshot(`
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
          <ExternalLink
            href="http://www.example.com"
          >
            http://www.example.com
          </ExternalLink>
           go here
           
          <common-message-layout__MentionedUsername
            prefix="@"
            userId={123}
          />
           or here 
          <ExternalLink
            href="http://www.example.com"
          >
            http://www.example.com
          </ExternalLink>
        </common-message-layout__Text>
      </TimestampMessageLayout>
    `)
  })

  test('message with a mention of self user', () => {
    expect(doRender('Hey <@1>')).toMatchInlineSnapshot(`
      <TimestampMessageLayout
        highlighted={true}
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
          Hey
           
          <common-message-layout__MentionedUsername
            prefix="@"
            userId={1}
          />
        </common-message-layout__Text>
      </TimestampMessageLayout>
    `)
  })
})
