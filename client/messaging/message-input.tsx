import {
  SetStateAction,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { CHAT_MESSAGE_MAXLENGTH } from '../../common/constants'
import { RestrictionKind } from '../../common/users/restrictions'
import { useSelfUser } from '../auth/auth-utils'
import { ConnectedAvatar } from '../avatars/avatar'
import { openSimpleDialog } from '../dialogs/action-creators'
import { longTimestamp } from '../i18n/date-formats'
import { useKeyListener } from '../keyboard/key-listener'
import logger from '../logging/logger'
import { MenuItem } from '../material/menu/item'
import { getMenuItemId, MenuList } from '../material/menu/menu'
import { Popover, useElemAnchorPosition, usePopoverController } from '../material/popover'
import { TextField } from '../material/text-field'
import { useStableCallback } from '../react/state-hooks'
import { useAppDispatch, useAppSelector, useAppStore } from '../redux-hooks'
import { CommandContext } from './commands/command-context'
import { CommandMenuItem } from './commands/command-menu-item'
import { createCommandArgProvider, createCommandNameProvider } from './commands/command-provider'
import { LocalLineEmitter } from './commands/local-output'
import { runChatCommand } from './commands/run-chat-command'
import { EmotePickerButton } from './emote-picker'
import { emoteProvider } from './emote-provider'
import { createMentionProvider, MentionableUser } from './mention-provider'
import {
  matchTypeahead,
  TypeaheadProvider,
  TypeaheadSuggestion,
  TypeaheadVisual,
} from './typeahead'

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

// The rows of the command palette line their usage and description up with each other, which takes
// the columns living on the list. The list's own padding elements span them both.
const CommandMenuList = styled(StyledMenuList)`
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  max-width: min(640px, calc(100vw - 32px));

  & > * {
    grid-column: 1 / -1;
  }
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

/** The icon a suggestion row shows, if it has one. */
function suggestionIcon(visual: TypeaheadVisual): React.ReactNode {
  switch (visual.kind) {
    case 'user':
      return <StyledAvatar userId={visual.userId} $faded={visual.online === false} />
    case 'emoji':
      return <EmoteSuggestionIcon>{visual.emoji}</EmoteSuggestionIcon>
    case 'command':
    case 'plain':
      return undefined
    default:
      return assertUnreachable(visual)
  }
}

/** Whether a suggestion row is shown dimmed, e.g. a user who is known to be offline. */
function isSuggestionFaded(visual: TypeaheadVisual): boolean {
  switch (visual.kind) {
    case 'user':
      return visual.online === false
    case 'command':
    case 'emoji':
    case 'plain':
      return false
    default:
      return assertUnreachable(visual)
  }
}

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

/** What an input needs to run the chat commands its surface offers. */
export interface MessageInputCommands {
  /** The surface the input belongs to, which decides what commands can be run and how they act. */
  context: CommandContext
  /** Takes the only-you lines a command answers with into the surface. */
  emit: LocalLineEmitter
}

/** The palette the input is currently offering, and where its rows would be typed. */
interface ActiveTypeahead {
  provider: TypeaheadProvider
  /** Index in the message where the text the rows complete starts. */
  start: number
  /** The text the rows complete: from `start` up to the caret. */
  matchedText: string
  suggestions: ReadonlyArray<TypeaheadSuggestion>
  /** Enter on an exact suggestion sends the message instead of accepting the suggestion. */
  submitOnExact: boolean
  /** Space accepts the suggestion when it is the only one offered and it is not exact. */
  spaceAcceptsSingle: boolean
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
  /**
   * What the input needs to treat submitted text starting with a slash as a command. Without it,
   * everything the user submits is sent as an ordinary message. It also drives the command and
   * argument palettes offered while a command is being typed.
   */
  commands?: MessageInputCommands
  /** Exposes focus and mention insertion to the owner. */
  ref?: React.Ref<MessageInputHandle>
}

export interface MessageInputHandle {
  focus: () => void
  addMention: (username: string) => void
}

// A plain function component rather than a forwardRef one: react-dom only refreshes
// `useEffectEvent` handlers on plain function components, and a forwardRef wrapper would leave
// `onSelectionChange` frozen at its mount-time closure.
export function MessageInput({
  className,
  showDivider,
  maxRows = 20,
  storageKey,
  mentionableUsers,
  baseMentionableUsers,
  commands,
  onSendChatMessage,
  ref,
}: MessageInputProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const user = useSelfUser()
  const chatRestriction = useAppSelector(s => s.auth.self?.restrictions.get(RestrictionKind.Chat))
  const combinedStorageKey = user && storageKey ? `${user.id}-${storageKey}` : undefined
  const [message, setMessage] = useStorageSyncedState('', combinedStorageKey)
  const inputRef = useRef<HTMLInputElement>(null)
  const [containerElem, setContainerElem] = useState<HTMLDivElement | null>(null)

  const [typeahead, setTypeahead] = useState<ActiveTypeahead | undefined>(undefined)
  const [activeIndex, setActiveIndex] = useState(0)
  const [paletteOpen, openPalette, closePalette] = usePopoverController()
  // Guards suggestions that load asynchronously against the caret having moved on by the time
  // they arrive
  const latestRequestRef = useRef(0)
  const listId = useId()

  const [anchorX, anchorY] = useElemAnchorPosition(containerElem, 'left', 'top')

  // The first provider to claim the caret owns the palette, so the more specific ones come first.
  const providers: TypeaheadProvider[] = []
  if (commands) {
    const deps = { context: commands.context, getState: store.getState, t }
    providers.push(createCommandNameProvider(deps), createCommandArgProvider(deps))
  }
  if (mentionableUsers) {
    providers.push(createMentionProvider(mentionableUsers, baseMentionableUsers))
  }
  providers.push(emoteProvider)

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

  const onSelectionChange = useEffectEvent((event: Event) => {
    if (!(event.target instanceof HTMLTextAreaElement)) {
      return
    }

    // A caret moving through the text is what a palette completes at; an actual selection is not
    // a position to complete anything at.
    const { selectionStart, selectionEnd } = event.target
    if (selectionStart === null || selectionStart !== selectionEnd) {
      return
    }

    // TODO(2Pac): Handle channel mentions as well.

    // The DOM value is what the caret offsets refer to; React state can still be a render behind.
    const textBeforeCaret = event.target.value.slice(0, selectionStart)

    const requestId = ++latestRequestRef.current
    const result = matchTypeahead(providers, textBeforeCaret)
    if (!result) {
      setTypeahead(undefined)
      closePalette()
      return
    }

    const { provider, match } = result
    const apply = (suggestions: ReadonlyArray<TypeaheadSuggestion>) => {
      if (latestRequestRef.current !== requestId) {
        // A later caret position superseded this one
        return
      }

      if (provider.id !== typeahead?.provider.id) {
        // A different kind of palette starts at its first row rather than wherever the last one
        // was left
        setActiveIndex(0)
      }
      setTypeahead({
        provider,
        start: match.start,
        matchedText: match.matchedText,
        suggestions,
        submitOnExact: !!match.submitOnExact,
        spaceAcceptsSingle: !!match.spaceAcceptsSingle,
      })

      if (suggestions.length > 0) {
        openPalette(event)
      } else {
        closePalette()
      }
    }

    if (match.suggestions instanceof Promise) {
      match.suggestions.then(apply, (err: Error) =>
        logger.error(`Failed to load typeahead suggestions: ${String(err)}`),
      )
    } else {
      apply(match.suggestions)
    }
  })

  useEffect(() => {
    const inputRefValue = inputRef.current
    inputRefValue?.addEventListener('selectionchange', onSelectionChange)
    return () => inputRefValue?.removeEventListener('selectionchange', onSelectionChange)
  }, [])

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

  const suggestions = typeahead?.suggestions ?? []
  // NOTE: The active index is clamped because the suggestion lists can shrink while an index
  // further down is focused (the menu keeps its index when its children change)
  const clampedActiveIndex = Math.min(activeIndex, Math.max(suggestions.length - 1, 0))
  const activeSuggestion = suggestions[clampedActiveIndex]
  const paletteShowing = paletteOpen && suggestions.length > 0

  // Clearing the input programmatically moves the caret without a `selectionchange` event, so
  // what was derived from the old caret position has to be dropped by hand.
  const clearInput = () => {
    latestRequestRef.current += 1
    setTypeahead(undefined)
    setActiveIndex(0)
    closePalette()
    setMessage('')
  }

  const acceptSuggestion = (suggestion: TypeaheadSuggestion) => {
    if (!typeahead) {
      return
    }

    const { provider, start, matchedText } = typeahead
    closePalette()
    setActiveIndex(0)
    provider.onAccept?.(suggestion)
    setMessage(
      message.slice(0, start) + suggestion.insertText + message.slice(start + matchedText.length),
    )

    if (!inputRef.current) {
      return
    }

    inputRef.current.focus()
    // Setting the caret position immediately after the focus doesn't work for some
    // reason, so we need to wait a tick first.
    queueMicrotask(() => {
      const newCaretPosition = start + suggestion.insertText.length
      inputRef.current?.setSelectionRange(newCaretPosition, newCaretPosition)
    })
  }

  const onEnterKeyDown = useStableCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (paletteShowing && typeahead && activeSuggestion) {
      if (typeahead.submitOnExact && activeSuggestion.exact) {
        // What's typed already spells the highlighted suggestion, so Enter means send
        closePalette()
      } else {
        event.preventDefault()
        acceptSuggestion(activeSuggestion)
        return
      }
    }

    if (event.shiftKey) {
      return
    }

    event.preventDefault()

    if (message.trim().length > 0) {
      const toSend = message.trim()
      if (toSend.length > CHAT_MESSAGE_MAXLENGTH) {
        // Blocked rather than sent-and-trimmed so no content is silently lost — the message
        // stays in the input for the user to shorten
        dispatch(
          openSimpleDialog(
            t('messaging.messageTooLongTitle', 'Message too long'),
            t('messaging.messageTooLongContent', {
              defaultValue:
                'Messages can be at most {{maxLength}} characters, and this one is {{length}}. Please shorten it before sending.',
              maxLength: CHAT_MESSAGE_MAXLENGTH,
              length: toSend.length,
            }),
          ),
        )
        return
      }

      if (commands) {
        // A command is never also sent as chat text, and the input is cleared whether the command
        // ran or was refused: what it answered with is in the conversation, and a rejected command
        // is retyped rather than left sitting in the input.
        const result = runChatCommand(toSend, {
          context: commands.context,
          dispatch,
          t,
          emit: commands.emit,
        })
        if (result.kind === 'text') {
          onSendChatMessage(result.text)
        }
        clearInput()
        return
      }

      onSendChatMessage(toSend)
      clearInput()
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

  const SuggestionList = typeahead?.provider.id === 'command' ? CommandMenuList : StyledMenuList

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
        maxLength={CHAT_MESSAGE_MAXLENGTH}
        showDivider={showDivider}
        disabled={!!chatRestriction}
        trailingIcons={[
          <EmotePickerButton key='emotes' disabled={!!chatRestriction} onInsert={insertAtCaret} />,
        ]}
        inputProps={{
          autoComplete: 'off',
          role: 'combobox',
          'aria-autocomplete': 'list',
          'aria-expanded': paletteShowing,
          'aria-controls': paletteShowing ? listId : undefined,
          'aria-activedescendant': paletteShowing
            ? getMenuItemId(listId, clampedActiveIndex)
            : undefined,
          onClick: event => {
            if (paletteShowing) {
              // Prevent the suggestion popover from closing when the user clicks on the input
              // and we have matches at the current position of their caret.
              event.stopPropagation()
            }
          },
        }}
        onKeyDown={event => {
          if (event.key === 'Tab') {
            if (paletteShowing && activeSuggestion) {
              event.preventDefault()
              acceptSuggestion(activeSuggestion)
            }
          } else if (event.key === ' ') {
            // When a palette has narrowed to one row that isn't typed out yet, the space that
            // would move past it accepts it instead; its inserted text carries the space along.
            const onlySuggestion = suggestions.length === 1 ? suggestions[0] : undefined
            if (
              paletteShowing &&
              typeahead?.spaceAcceptsSingle &&
              onlySuggestion &&
              !onlySuggestion.exact
            ) {
              event.preventDefault()
              acceptSuggestion(onlySuggestion)
            }
          }
        }}
        onEnterKeyDown={onEnterKeyDown}
        onChange={onChange}
      />

      <Popover
        open={paletteOpen}
        onDismiss={() => {
          setActiveIndex(0)
          closePalette()
        }}
        anchorX={anchorX ?? 0}
        anchorY={(anchorY ?? 0) - 8}
        originX='left'
        originY='bottom'
        // Keep the focus in the message input when the suggestions open so the user can keep
        // typing.
        focusOnMount={false}>
        <SuggestionList
          key={typeahead?.provider.id}
          id={listId}
          role='listbox'
          dense={true}
          virtualFocus={true}
          onActiveIndexChange={setActiveIndex}>
          {suggestions.map(suggestion =>
            suggestion.visual.kind === 'command' ? (
              <CommandMenuItem
                key={suggestion.key}
                command={suggestion.visual.command}
                description={suggestion.visual.description}
                onClick={() => acceptSuggestion(suggestion)}
              />
            ) : (
              <StyledMenuItem
                key={suggestion.key}
                text={suggestion.text}
                secondaryText={suggestion.secondaryText}
                $faded={isSuggestionFaded(suggestion.visual)}
                icon={suggestionIcon(suggestion.visual)}
                onClick={() => acceptSuggestion(suggestion)}
              />
            ),
          )}
        </SuggestionList>
      </Popover>
    </>
  )
}
