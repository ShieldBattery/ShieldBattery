import React, { useCallback, useRef, useState } from 'react'
import styled from 'styled-components'
import KeyListener from '../keyboard/key-listener'
import TextField from '../material/text-field'
import { colorDividers } from '../styles/colors'

const StyledTextField = styled(TextField)<{ showDivider?: boolean }>`
  flex-shrink: 0;
  position: relative;
  padding: 8px 16px;
  contain: content;

  &::after {
    position: absolute;
    height: 1px;
    left: 0px;
    right: 0px;
    top: 0;

    content: '';
    border-top: 1px solid ${props => (props.showDivider ? colorDividers : 'transparent')};
    transition: border 250ms linear;
  }
`

export interface MessageInputProps {
  className?: string
  showDivider?: boolean
  onSendChatMessage: (msg: string) => void
}

export default function MessageInput(props: MessageInputProps) {
  const [message, setMessage] = useState<string>('')
  const inputRef = useRef<TextField | null>(null)

  const onChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target
      if (value !== message) {
        setMessage(value)
      }
    },
    [message],
  )

  const onEnterKeyDown = useCallback(() => {
    if (message) {
      props.onSendChatMessage(message)
      setMessage('')
    }
  }, [message, props.onSendChatMessage])

  const onKeyPress = useCallback(
    (event: React.KeyboardEvent<TextField>) => {
      const target = event.target as HTMLElement

      if (
        event.ctrlKey ||
        event.altKey ||
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
      ) {
        return false
      }

      const key = event.key ? event.key : String.fromCharCode(event.charCode)
      if (key && key.length === 1) {
        if (key === ' ' && target.tagName === 'BUTTON') {
          // Space bar should click the button, rather than doing any of this
          return false
        }

        inputRef.current?.focus()
        setMessage(message + key)
        return true
      }

      return false
    },
    [message, inputRef.current],
  )

  return (
    <>
      <KeyListener onKeyPress={onKeyPress} />
      <StyledTextField
        ref={inputRef}
        className={props.className}
        label='Send a message'
        value={message}
        maxLength={500}
        floatingLabel={false}
        allowErrors={false}
        showDivider={props.showDivider}
        inputProps={{ autoComplete: 'off' }}
        onEnterKeyDown={onEnterKeyDown}
        onChange={onChange}
      />
    </>
  )
}
