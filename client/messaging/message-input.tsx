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
import styled, { css } from 'styled-components'
import { matchUserMentions } from '../../common/text/user-mentions'
import { RestrictionKind } from '../../common/users/restrictions'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import { ConnectedAvatar } from '../avatars/avatar'
import { longTimestamp } from '../i18n/date-formats'
import { useKeyListener } from '../keyboard/key-listener'
import logger from '../logging/logger'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, useElemAnchorPosition, usePopoverController } from '../material/popover'
import { TextField } from '../material/text-field'
import { useStableCallback } from '../react/state-hooks'
import { useAppSelector } from '../redux-hooks'
import { getUnicodeEmojiEntries } from './emoji-data'
import { EmotePickerButton } from './emote-picker'
import {
  EMOTE_QUERY_REGEX,
  EmoteSuggestion,
  MAX_EMOTE_SUGGESTIONS,
  mergeEmoteSuggestions,
  recordEmoteUsage,
  searchCustomEmotes,
  searchUnicodeEmojis,
} from './emote-suggestions'
import { applyTextArtCommand } from './text-art'

// We limit the number of users we display in user mention popup to 10 so we don't need to have
// scrollbars; and usually the person who is trying to mention someone is interested in only one
// user anyway.
export const MAX_MENTIONED_USERS = 10

export interface MentionableUser {
  id: SbUserId
  name: string
  online: boolean
}

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

const StyledMenuItem = styled(MenuItem)<{ $faded?: boolean }>`
  ${props => {
    if (props.$faded) {
      return css`
        color: var(--theme-on-surface-variant);
      `
    }
    return ''
  }}
`

const StyledAvatar = styled(ConnectedAvatar)<{ $faded?: boolean }>`
  width: 24px;
  height: 24px;

  ${props => {
    if (props.$faded) {
      return css`
        opacity: var(--theme-disabled-opacity);
      `
    }
    return ''
  }}
`

const EmoteSuggestionIcon = styled.span`
  width: 24px;
  font-size: 18px;
  line-height: 24px;
  text-align: center;
`

const EmoteSuggestionImg = styled.img`
  width: 22px;
  height: 22px;
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
  maxRows?: number
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
  mentionableUsers?: MentionableUser[]
  /**
   * Similar to the `mentionableUsers` property above, except this list will be used when the user
   * has only typed the @ character and nothing else after it.
   */
  baseMentionableUsers?: MentionableUser[]
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
      maxRows = 20,
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
    const [containerElem, setContainerElem] = useState<HTMLDivElement | null>(null)

    const [userMentionStartIndex, setUserMentionStartIndex] = useState<number>(-1)
    const [userMentionMatchedText, setUserMentionMatchedText] = useState<string>('')
    const [matchedUsers, setMatchedUsers] = useState<MentionableUser[]>([])
    const [virtuallyFocusedMentionIndex, setVirtuallyFocusedMentionIndex] = useState<number>(0)

    const [emoteQueryStart, setEmoteQueryStart] = useState<number>(-1)
    const [emoteMatchedText, setEmoteMatchedText] = useState<string>('')
    const [matchedEmotes, setMatchedEmotes] = useState<EmoteSuggestion[]>([])
    const [focusedEmoteIndex, setFocusedEmoteIndex] = useState<number>(0)
    // Guards async emoji data loads against the query having changed by the time they finish
    const latestEmoteQueryRef = useRef<string | undefined>(undefined)

    const fuzzy = useMemo(() => new UFuzzy({ intraIns: Infinity, intraChars: '.' }), [])

    const [userMentionsOpen, openUserMentions, closeUserMentions] = usePopoverController()
    const [emotesOpen, openEmotes, closeEmotes] = usePopoverController()
    const [anchorX, anchorY] = useElemAnchorPosition(containerElem, 'left', 'top')

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
        if (event.target instanceof HTMLTextAreaElement) {
          // This logic looks for the caret moving within a message that starts with @, while
          // ignoring any cases where the user has made an actual selection.

          const { selectionStart, selectionEnd } = event.target
          if (selectionStart === null || selectionStart !== selectionEnd) {
            return
          }

          // TODO(2Pac): Handle channel mentions as well.

          const emoteMatch = EMOTE_QUERY_REGEX.exec(message.slice(0, selectionStart))
          if (emoteMatch) {
            const query = emoteMatch.groups!.query
            latestEmoteQueryRef.current = query
            setEmoteQueryStart(emoteMatch.index)
            setEmoteMatchedText(emoteMatch[0])

            const customSuggestions = searchCustomEmotes(query)
            setMatchedEmotes(customSuggestions.slice(0, MAX_EMOTE_SUGGESTIONS))
            if (customSuggestions.length) {
              openEmotes(event)
            } else {
              closeEmotes()
            }

            getUnicodeEmojiEntries().then(
              entries => {
                if (latestEmoteQueryRef.current !== query) {
                  return
                }
                const suggestions = mergeEmoteSuggestions(
                  customSuggestions,
                  searchUnicodeEmojis(entries, query),
                )
                setMatchedEmotes(suggestions)
                if (suggestions.length) {
                  openEmotes(event)
                } else {
                  closeEmotes()
                }
              },
              (err: Error) => logger.error(`Failed to load emoji data: ${String(err)}`),
            )
          } else {
            latestEmoteQueryRef.current = undefined
            closeEmotes()
          }

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
      openEmotes,
      closeEmotes,
      fuzzy,
    ])

    const onChange = useStableCallback((event: React.ChangeEvent<HTMLInputElement>) => {
      const message = event.target.value
      setMessage(message)
    })

    const insertAtCaret = useStableCallback((text: string) => {
      // The selection values persist while the input is unfocused (e.g. while the emote picker has
      // focus), so this inserts wherever the caret last was, replacing any selected content.
      const start = inputRef.current?.selectionStart ?? message.length
      const end = inputRef.current?.selectionEnd ?? message.length
      setMessage(msg => msg.slice(0, start) + text + msg.slice(end))

      inputRef.current?.focus()
      // Setting the caret position immediately after the focus doesn't work for some reason, so we
      // need to wait a tick first.
      queueMicrotask(() => {
        const newCaretPosition = start + text.length
        inputRef.current?.setSelectionRange(newCaretPosition, newCaretPosition)
      })
    })

    const onMentionSelect = (user: MentionableUser) => {
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
      // Setting the caret position immediately after the focus doesn't work for some
      // reason, so we need to wait a tick first.
      queueMicrotask(() => {
        const newCaretPosition = userMentionStartIndex + user.name.length + 2
        inputRef.current?.setSelectionRange(newCaretPosition, newCaretPosition)
      })
    }

    const onEmoteSelect = (suggestion: EmoteSuggestion) => {
      closeEmotes()
      setFocusedEmoteIndex(0)
      recordEmoteUsage(suggestion.key)

      if (emoteQueryStart > -1 && emoteMatchedText) {
        setMessage(
          message.slice(0, emoteQueryStart) +
            suggestion.insertText +
            message.slice(emoteQueryStart + emoteMatchedText.length),
        )
      }

      if (!inputRef.current) {
        return
      }

      inputRef.current.focus()
      // Setting the caret position immediately after the focus doesn't work for some
      // reason, so we need to wait a tick first.
      queueMicrotask(() => {
        const newCaretPosition = emoteQueryStart + suggestion.insertText.length
        inputRef.current?.setSelectionRange(newCaretPosition, newCaretPosition)
      })
    }

    const onEnterKeyDown = useStableCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
      // NOTE: The focused indexes are clamped because the suggestion lists can shrink while an
      // index further down is focused (the menu keeps its index when its children change)
      if (emotesOpen && matchedEmotes.length > 0) {
        event.preventDefault()
        onEmoteSelect(matchedEmotes[Math.min(focusedEmoteIndex, matchedEmotes.length - 1)])
        return
      }

      if (userMentionsOpen && matchedUsers.length > 0) {
        event.preventDefault()
        onMentionSelect(
          matchedUsers[Math.min(virtuallyFocusedMentionIndex, matchedUsers.length - 1)],
        )
        setVirtuallyFocusedMentionIndex(0)
        return
      }

      if (event.shiftKey) {
        return
      }

      event.preventDefault()

      if (message.trim().length > 0) {
        onSendChatMessage(applyTextArtCommand(message.trim()))
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
        defaultValue: 'Restricted from sending messages until {{date}}',
        date,
      })
    }

    return (
      <>
        <StyledTextField
          ref={inputRef}
          containerRef={setContainerElem}
          className={className}
          label={label}
          value={message}
          multiline={true}
          rows={1}
          maxRows={maxRows}
          floatingLabel={false}
          allowErrors={false}
          showDivider={showDivider}
          disabled={!!chatRestriction}
          trailingIcons={[
            <EmotePickerButton
              key='emotes'
              disabled={!!chatRestriction}
              onInsert={insertAtCaret}
            />,
          ]}
          inputProps={{
            autoComplete: 'off',
            onClick: event => {
              if (userMentionsOpen || emotesOpen) {
                // Prevent the suggestion popovers from closing when the user clicks on the input
                // and we have matches at the current position of their caret.
                event.stopPropagation()
              }
            },
          }}
          onKeyDown={event => {
            if (event.key === 'Tab') {
              // Indexes clamped for the same reason as in onEnterKeyDown
              if (emotesOpen && matchedEmotes.length > 0) {
                event.preventDefault()
                onEmoteSelect(matchedEmotes[Math.min(focusedEmoteIndex, matchedEmotes.length - 1)])
              } else if (userMentionsOpen && matchedUsers.length > 0) {
                event.preventDefault()
                onMentionSelect(
                  matchedUsers[Math.min(virtuallyFocusedMentionIndex, matchedUsers.length - 1)],
                )
                setVirtuallyFocusedMentionIndex(0)
              }
            }
          }}
          onEnterKeyDown={onEnterKeyDown}
          onChange={onChange}
        />

        <Popover
          open={userMentionsOpen}
          onDismiss={() => {
            setVirtuallyFocusedMentionIndex(0)
            closeUserMentions()
          }}
          anchorX={anchorX ?? 0}
          anchorY={(anchorY ?? 0) - 8}
          originX='left'
          originY='bottom'
          // Keep the focus in the message input when user mentions popover opens so the user can
          // keep typing.
          focusOnMount={false}>
          <StyledMenuList
            dense={true}
            virtualFocus={true}
            onActiveIndexChange={setVirtuallyFocusedMentionIndex}>
            {matchedUsers.map(user => (
              <StyledMenuItem
                key={user.id}
                text={user.name}
                $faded={!user.online}
                icon={<StyledAvatar userId={user.id} $faded={!user.online} />}
                onClick={() => onMentionSelect(user)}
              />
            ))}
          </StyledMenuList>
        </Popover>

        <Popover
          open={emotesOpen}
          onDismiss={() => {
            setFocusedEmoteIndex(0)
            closeEmotes()
          }}
          anchorX={anchorX ?? 0}
          anchorY={(anchorY ?? 0) - 8}
          originX='left'
          originY='bottom'
          // Keep the focus in the message input when the emote suggestions open so the user can
          // keep typing.
          focusOnMount={false}>
          <StyledMenuList
            dense={true}
            virtualFocus={true}
            onActiveIndexChange={setFocusedEmoteIndex}>
            {matchedEmotes.map(suggestion => (
              <StyledMenuItem
                key={suggestion.key}
                text={suggestion.name}
                icon={
                  suggestion.imgUrl ? (
                    <EmoteSuggestionImg src={suggestion.imgUrl} alt='' />
                  ) : (
                    <EmoteSuggestionIcon>{suggestion.emoji}</EmoteSuggestionIcon>
                  )
                }
                onClick={() => onEmoteSelect(suggestion)}
              />
            ))}
          </StyledMenuList>
        </Popover>
      </>
    )
  },
)
