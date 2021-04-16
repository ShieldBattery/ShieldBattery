import React, { useCallback, useState } from 'react'
import styled from 'styled-components'
import MessageInput, { MessageInputProps } from '../messaging/message-input'
import MessageList, { MessageListProps } from '../messaging/message-list'

const MessagesAndInput = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 320px;
  height: 100%;
  contain: content;
`

const StyledMessageList = styled(MessageList)`
  flex-grow: 1;
`

interface ChatProps extends MessageListProps, MessageInputProps {
  className?: string
}

/**
 * This is a general chat component that combines `MessageList` and `MessageInput` components into
 * one, with some common styling. We're using this component in pretty much all of our
 * messaging-related services (e.g. chat channels, whispers, lobbies, parties), but in case you need
 * to do something special, you can always use `MessageList` and `MessageInput` directly.
 */
export default function Chat(props: ChatProps) {
  const [isScrolledUp, setIsScrolledUp] = useState<boolean>(false)

  const onScrollUpdate = useCallback(
    (target: EventTarget) => {
      const { scrollTop, scrollHeight, clientHeight } = target as HTMLDivElement

      const newIsScrolledUp = scrollTop + clientHeight < scrollHeight
      if (newIsScrolledUp !== isScrolledUp) {
        setIsScrolledUp(newIsScrolledUp)
      }

      if (props.onScrollUpdate) {
        props.onScrollUpdate(target)
      }
    },
    [isScrolledUp, props.onScrollUpdate],
  )

  return (
    <MessagesAndInput className={props.className}>
      <StyledMessageList
        messages={props.messages}
        renderMessage={props.renderMessage}
        loading={props.loading}
        hasMoreHistory={props.hasMoreHistory}
        onScrollUpdate={onScrollUpdate}
      />
      <MessageInput showDivider={isScrolledUp} onSendChatMessage={props.onSendChatMessage} />
    </MessagesAndInput>
  )
}
