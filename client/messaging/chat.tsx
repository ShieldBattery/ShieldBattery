import React, { useCallback, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user'
import { MessageInput, MessageInputHandle, MessageInputProps } from '../messaging/message-input'
import MessageList, { MessageListProps } from '../messaging/message-list'
import { useAppDispatch } from '../redux-hooks'

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

interface ChatProps {
  className?: string
  listProps: Omit<MessageListProps, 'onScrollUpdate'>
  inputProps: Omit<MessageInputProps, 'showDivider'>
  /**
   * Optional extra content to place within the chat context provider. This is useful if you need to
   * e.g. mention users via shift-click from UIs outside the message list.
   */
  extraContent?: React.ReactNode
}

export interface ChatContextValue {
  mentionUser: (userId: SbUserId) => void
}
export const ChatContext = React.createContext<ChatContextValue>({
  mentionUser: () => {},
})

/**
 * This is a general chat component that combines `MessageList` and `MessageInput` components into
 * one, with some common styling. We're using this component in pretty much all of our
 * messaging-related services (e.g. chat channels, whispers, lobbies, parties), but in case you need
 * to do something special, you can always use `MessageList` and `MessageInput` directly.
 */
export function Chat(props: ChatProps) {
  const dispatch = useAppDispatch()
  const [isScrolledUp, setIsScrolledUp] = useState<boolean>(false)

  const onScrollUpdate = useCallback((target: EventTarget) => {
    const { scrollTop, scrollHeight, clientHeight } = target as HTMLDivElement

    const newIsScrolledUp = scrollTop + clientHeight < scrollHeight
    setIsScrolledUp(newIsScrolledUp)
  }, [])

  const messageInputRef = useRef<MessageInputHandle>(null)

  const chatContextValue = useMemo<ChatContextValue>(
    () => ({
      mentionUser: userId => {
        dispatch((_, getState) => {
          const { users } = getState()
          const user = users.byId.get(userId)
          if (user) {
            messageInputRef.current?.addMention(user.name)
          }
        })
      },
    }),
    [dispatch],
  )

  return (
    <ChatContext.Provider value={chatContextValue}>
      <MessagesAndInput className={props.className}>
        <StyledMessageList {...props.listProps} onScrollUpdate={onScrollUpdate} />
        <MessageInput {...props.inputProps} ref={messageInputRef} showDivider={isScrolledUp} />
      </MessagesAndInput>
      {props.extraContent}
    </ChatContext.Provider>
  )
}
