import React from 'react'
import ShallowRenderer from 'react-test-renderer/shallow'
import { SbUserId } from '../../common/users/user-info'
import { TextMessage } from './common-message-layout'

describe('client/messaging/common-message-layout/TextMessage', () => {
  const renderer = ShallowRenderer.createRenderer()
  const doMatch = (text: string): React.ReactElement => {
    renderer.render(
      <TextMessage userId={2 as SbUserId} selfUserId={1 as SbUserId} time={0} text={text} />,
    )
    return renderer.getRenderOutput()
  }

  test('message as a normal text', () => {
    expect(doMatch('This is test message')).toMatchInlineSnapshot(`
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
    expect(doMatch('here is a link http://www.example.com')).toMatchInlineSnapshot(`
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
          <a
            href="http://www.example.com"
            rel="noopener nofollow"
            target="_blank"
          >
            http://www.example.com
          </a>
        </common-message-layout__Text>
      </TimestampMessageLayout>
    `)
  })

  test('message with a mention', () => {
    expect(doMatch('hey <@123>')).toMatchInlineSnapshot(`
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
           
          <common-message-layout__UserMention>
            <ConnectedUsername
              isMention={true}
              userId={123}
            />
          </common-message-layout__UserMention>
          
        </common-message-layout__Text>
      </TimestampMessageLayout>
    `)
  })

  test('message with a link before a mention', () => {
    expect(doMatch('http://www.example.com go here <@123>')).toMatchInlineSnapshot(`
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
          <a
            href="http://www.example.com"
            rel="noopener nofollow"
            target="_blank"
          >
            http://www.example.com
          </a>
           go here
           
          <common-message-layout__UserMention>
            <ConnectedUsername
              isMention={true}
              userId={123}
            />
          </common-message-layout__UserMention>
          
        </common-message-layout__Text>
      </TimestampMessageLayout>
    `)
  })

  test('message with a link between mentions', () => {
    expect(doMatch('hey <@123> see http://www.example.com go here <@123>')).toMatchInlineSnapshot(`
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
           
          <common-message-layout__UserMention>
            <ConnectedUsername
              isMention={true}
              userId={123}
            />
          </common-message-layout__UserMention>
           
          see 
          <a
            href="http://www.example.com"
            rel="noopener nofollow"
            target="_blank"
          >
            http://www.example.com
          </a>
           go here
           
          <common-message-layout__UserMention>
            <ConnectedUsername
              isMention={true}
              userId={123}
            />
          </common-message-layout__UserMention>
          
        </common-message-layout__Text>
      </TimestampMessageLayout>
    `)
  })

  test('message with a link containing a mention', () => {
    expect(doMatch('http://www.<@123>.com')).toMatchInlineSnapshot(`
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
          <a
            href="http://www.<@123>.com"
            rel="noopener nofollow"
            target="_blank"
          >
            http://www.&lt;@123&gt;.com
          </a>
        </common-message-layout__Text>
      </TimestampMessageLayout>
    `)
  })

  test('message with a mention before a link', () => {
    expect(doMatch('<@123> go to http://www.example.com')).toMatchInlineSnapshot(`
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
          
          <common-message-layout__UserMention>
            <ConnectedUsername
              isMention={true}
              userId={123}
            />
          </common-message-layout__UserMention>
           
          go to 
          <a
            href="http://www.example.com"
            rel="noopener nofollow"
            target="_blank"
          >
            http://www.example.com
          </a>
        </common-message-layout__Text>
      </TimestampMessageLayout>
    `)
  })

  test('message with a mention between links', () => {
    expect(doMatch('http://www.example.com go here <@123> or here http://www.example.com'))
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
          <a
            href="http://www.example.com"
            rel="noopener nofollow"
            target="_blank"
          >
            http://www.example.com
          </a>
           go here
           
          <common-message-layout__UserMention>
            <ConnectedUsername
              isMention={true}
              userId={123}
            />
          </common-message-layout__UserMention>
           
          or here 
          <a
            href="http://www.example.com"
            rel="noopener nofollow"
            target="_blank"
          >
            http://www.example.com
          </a>
        </common-message-layout__Text>
      </TimestampMessageLayout>
    `)
  })

  test('message with a mention containing a link', () => {
    expect(doMatch('<@http://www.example.com>')).toMatchInlineSnapshot(`
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
          &lt;@
          <a
            href="http://www.example.com>"
            rel="noopener nofollow"
            target="_blank"
          >
            http://www.example.com&gt;
          </a>
        </common-message-layout__Text>
      </TimestampMessageLayout>
    `)
  })
})
