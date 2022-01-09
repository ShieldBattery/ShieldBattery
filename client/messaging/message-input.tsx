import React, { useCallback, useImperativeHandle, useRef, useState } from 'react'
import styled from 'styled-components'
import { useKeyListener } from '../keyboard/key-listener'
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

export interface MessageInputHandle {
  focus: () => void
  addMention: (username: string) => void
}

export const MessageInput = React.forwardRef<MessageInputHandle, MessageInputProps>(
  (props, ref) => {
    const [message, setMessage] = useState('')
    const inputRef = useRef<TextField>(null)

    useImperativeHandle(ref, () => ({
      focus: () => {
        inputRef.current?.focus()
      },
      addMention: username => {
        setMessage(msg => {
          // TODO(tec27): Would be nice to deal with the current selection here (and place the
          // mention at the cursor, or replace selected content). Currently this is a bit annoying
          // as the shift-click tends to change the selection itself, perhaps we need to handle this
          // on mouseup? Or control the selection bounds ourselves instead of relying on the
          // browser values?
          if (!msg.length) {
            return `@${username} `
          } else if (msg.endsWith(' ')) {
            return `${msg}@${username} `
          } else {
            return `${msg} @${username} `
          }
        })
        inputRef.current?.focus()
      },
    }))

    const onChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
      setMessage(event.target.value)
    }, [])

    const { onSendChatMessage } = props
    const onEnterKeyDown = useCallback(() => {
      if (message) {
        onSendChatMessage(message)
        setMessage('')
      }
    }, [message, onSendChatMessage])

    useKeyListener({
      onKeyPress: useCallback(event => {
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
          setMessage(message => message + key)
          return true
        }

        return false
      }, []),
    })

    return (
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
    )
  },
)
