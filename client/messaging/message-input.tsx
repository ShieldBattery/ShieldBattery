import UFuzzy from '@leeoniya/ufuzzy'

import {
  SetStateAction,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { matchUserMentions } from '../../common/text/user-mentions'
import { RestrictionKind } from '../../common/users/restrictions'
import { SbUser } from '../../common/users/sb-user'
import { useSelfUser } from '../auth/auth-utils'
import { ConnectedAvatar } from '../avatars/avatar'
import { longTimestamp } from '../i18n/date-formats'
import { useKeyListener } from '../keyboard/key-listener'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, useElemAnchorPosition, usePopoverController } from '../material/popover'
import { TextField } from '../material/text-field'
import { useStableCallback } from '../react/state-hooks'
import { useAppSelector } from '../redux-hooks'

// We limit the number of users we display in user mention popup to 10 so we don't need to have
// scrollbars; and usually the person who is trying to mention someone is interested in only one
// user anyway.
export const MAX_MENTIONED_USERS = 10

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
    border-top: 1px solid
      ${props => (props.showDivider ? 'var(--theme-outline-variant)' : 'transparent')};
    transition: border 250ms linear;
  }
`

const StyledMenuList = styled(MenuList)`
  // Since we limit the number of items in the menu to 10, we don't need scrolling.
  max-height: none;
`

/** A Map to store the message input contents for each chat instance. */
const messageInputMap = new Map<string, string>()

function useStorageSyncedState(
  defaultInitialValue: string,
  key?: string,
): [value: string, setValue: (value: SetStateAction<string>) => void] {
  const [value, setValue] = useState<string>(() =>
    key ? (messageInputMap.get(key) ?? defaultInitialValue) : defaultInitialValue,
  )
  const syncedSetValue = useCallback(
    (value: SetStateAction<string>) => {
      if (typeof value === 'string') {
        setValue(value)
        if (key) {
          messageInputMap.set(key, value)
        }
      } else {
        setValue(prev => {
          const newValue = value(prev)
          if (key) {
            messageInputMap.set(key, newValue)
          }
          return newValue
        })
      }
    },
    [key],
  )
  return [value, syncedSetValue]
}

export interface MessageInputProps {
  className?: string
  showDivider?: boolean
  onSendChatMessage: (msg: string) => void
  /**
   * A key to store the current message input contents under (in a global Map). If provided, the
   * previous message input contents will be restored when the component is mounted (so the key
   * should uniquely identify the type + instance of the chat container). The key is prefixed with
   * the user's ID to handle user changing their account.
   */
  storageKey?: string
  /**
   * An optional list of users that can be mentioned in the message input. If provided, the message
   * input will display a popover with all matching users when the user starts typing something
   * *after* the @ character and there's a match.
   */
  mentionableUsers?: SbUser[]
  /**
   * Similar to the `mentionableUsers` property above, except this list will be used when the user
   * has only typed the @ character and nothing else after it.
   */
  baseMentionableUsers?: SbUser[]
}

export interface MessageInputHandle {
  focus: () => void
  addMention: (username: string) => void
}

export const MessageInput = React.forwardRef<MessageInputHandle, MessageInputProps>(
  (
    {
      className,
      showDivider,
      storageKey,
      mentionableUsers,
      baseMentionableUsers,
      onSendChatMessage,
    },
    ref,
  ) => {
    const { t } = useTranslation()
    const user = useSelfUser()
    const chatRestriction = useAppSelector(s => s.auth.self?.restrictions.get(RestrictionKind.Chat))
    const combinedStorageKey = user && storageKey ? `${user.id}-${storageKey}` : undefined
    const [message, setMessage] = useStorageSyncedState('', combinedStorageKey)
    const inputRef = useRef<HTMLInputElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    const [userMentionStartIndex, setUserMentionStartIndex] = useState<number>(-1)
    const [userMentionMatchedText, setUserMentionMatchedText] = useState<string>('')
    const [matchedUsers, setMatchedUsers] = useState<SbUser[]>([])

    const fuzzy = useMemo(() => new UFuzzy({ intraIns: Infinity, intraChars: '.' }), [])

    const [userMentionsOpen, openUserMentions, closeUserMentions] = usePopoverController()
    const [anchorX, anchorY] = useElemAnchorPosition(containerRef.current, 'left', 'top')

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

    useEffect(() => {
      const onSelectionChange = (event: Event) => {
        if (event.target instanceof HTMLInputElement) {
          // This logic looks for the caret moving within a message that starts with @, while
          // ignoring any cases where the user has made an actual selection.

          const { selectionStart, selectionEnd } = event.target
          if (selectionStart === null || selectionStart !== selectionEnd) {
            return
          }

          // TODO(2Pac): Handle channel mentions as well.

          if (mentionableUsers) {
            if (baseMentionableUsers?.length) {
              // Looking for an @ with no characters after it to display base mentionable users.
              const messageBeforeCaret = message.slice(0, selectionStart)
              if (messageBeforeCaret === '@' || messageBeforeCaret.endsWith(' @')) {
                setUserMentionStartIndex(selectionStart - 1)
                setUserMentionMatchedText('@')
                setMatchedUsers(baseMentionableUsers)
                openUserMentions(event)
                return
              }
            }

            // This gets the index of the last word in the message from the current caret position
            // going backwards until the @ character is reached.
            const userMentionStartIndex = message.slice(0, selectionStart).search(/(?<=^|\s)@\S*$/)
            if (userMentionStartIndex === -1) {
              closeUserMentions()
              return
            }

            const userMentions = Array.from(
              matchUserMentions(message.slice(userMentionStartIndex, selectionStart)),
            )
            // There should be only one mention here
            const userMention = userMentions[0]

            if (!userMention) {
              closeUserMentions()
              return
            }

            const matchedUserIndexes = fuzzy.filter(
              mentionableUsers.map(u => u.name),
              userMention.groups.username,
            )
            const matchedUsers = matchedUserIndexes?.map(i => mentionableUsers[i]) ?? []

            setUserMentionStartIndex(userMentionStartIndex)
            setUserMentionMatchedText(userMention.text)
            setMatchedUsers(matchedUsers.slice(0, MAX_MENTIONED_USERS))

            if (matchedUsers.length) {
              openUserMentions(event)
            } else {
              closeUserMentions()
            }
          }
        }
      }

      const inputRefValue = inputRef.current
      inputRefValue?.addEventListener('selectionchange', onSelectionChange)
      return () => inputRefValue?.removeEventListener('selectionchange', onSelectionChange)
    }, [
      message,
      mentionableUsers,
      baseMentionableUsers,
      openUserMentions,
      closeUserMentions,
      fuzzy,
    ])

    const onChange = useStableCallback((event: React.ChangeEvent<HTMLInputElement>) => {
      const message = event.target.value
      setMessage(message)
    })

    const onEnterKeyDown = useStableCallback(() => {
      if (message) {
        onSendChatMessage(message)
        setMessage('')
      }
    })

    useKeyListener({
      onKeyPress: useStableCallback((event: KeyboardEvent) => {
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
          if (key === ' ' && (target.tagName === 'BUTTON' || target.tagName === 'A')) {
            // Space bar should click the button/link, rather than doing any of this
            return false
          }

          inputRef.current?.focus()
          setMessage(message => message + key)
          return true
        }

        return false
      }),
    })

    let label = t('messaging.sendMessage', 'Send a message')
    if (chatRestriction) {
      // TODO(tec27): Once RelativeDuration has been out longer than a few months, use that instead
      const date = longTimestamp.format(chatRestriction.endTime)
      label = t('messaging.sendMessageChatRestricted', {
        defaultValue: 'Restricted from sending messages until {{ date }}',
        date,
      })
    }

    return (
      <>
        <StyledTextField
          ref={inputRef}
          containerRef={containerRef}
          className={className}
          label={label}
          value={message}
          floatingLabel={false}
          allowErrors={false}
          showDivider={showDivider}
          disabled={!!chatRestriction}
          inputProps={{
            autoComplete: 'off',
            onClick: event => {
              if (userMentionsOpen) {
                // Prevent the user mentions popover from closing when the user clicks on the input
                // and we have matched users at the current position of their caret.
                event.stopPropagation()
              }
            },
          }}
          onEnterKeyDown={onEnterKeyDown}
          onChange={onChange}
        />

        <Popover
          open={userMentionsOpen}
          onDismiss={closeUserMentions}
          anchorX={anchorX ?? 0}
          anchorY={(anchorY ?? 0) - 8}
          originX='left'
          originY='bottom'
          // Keep the focus in the message input when user mentions popover opens so the user can
          // keep typing.
          focusOnMount={false}>
          <StyledMenuList dense={true}>
            {matchedUsers.map((user, i) => (
              <MenuItem
                key={user.id}
                text={user.name}
                icon={<ConnectedAvatar userId={user.id} />}
                onClick={() => {
                  closeUserMentions()

                  if (userMentionStartIndex > -1 && userMentionMatchedText) {
                    setMessage(
                      message.slice(0, userMentionStartIndex) +
                        `@${user.name} ` +
                        message.slice(userMentionStartIndex + userMentionMatchedText.length),
                    )
                  }

                  if (!inputRef.current) {
                    return
                  }

                  inputRef.current.focus()
                  // Setting the caret position immediately after the focus doesn't work for some reason, so we
                  // need to wait a tick first.
                  queueMicrotask(() => {
                    const newCaretPosition = userMentionStartIndex + user.name.length + 2
                    inputRef.current?.setSelectionRange(newCaretPosition, newCaretPosition)
                  })
                }}
              />
            ))}
          </StyledMenuList>
        </Popover>
      </>
    )
  },
)
