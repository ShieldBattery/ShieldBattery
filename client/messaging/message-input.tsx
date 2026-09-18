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
import {
  matchReplyCommand,
  noReplyTargetLine,
  ReplyTarget,
  resolveReplyTarget,
  sendReply,
} from './commands/commands/reply'
import { LocalLineEmitter } from './commands/local-output'
import { runChatCommand } from './commands/run-chat-command'
import { EmotePickerButton } from './emote-picker'
import { emoteProvider } from './emote-provider'
import { createMentionProvider, MentionableUser } from './mention-provider'
import { ReplyChip } from './reply-chip'
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
  // The mention, emote and command-argument palettes are capped at MAX_TYPEAHEAD_ROWS rows, so
  // they never need to scroll.
  max-height: none;
`

// The rows of the command palette line their usage and description up with each other, which takes
// the columns living on the list. The list's own padding elements span them both. The command
// palette is uncapped, so it keeps MenuList's own max-height and scrolls past it.
const CommandMenuList = styled(MenuList)`
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

/**
 * A Map to store who each chat instance is composing a reply to, so that leaving a surface and
 * coming back to it restores the chip along with the text it belongs to.
 */
const replyTargetMap = new Map<string, ReplyTarget | undefined>()

function useStorageSyncedState<T>(
  storage: Map<string, T>,
  defaultInitialValue: T,
  key?: string,
): [value: T, setValue: (value: SetStateAction<T>) => void] {
  const [value, setValue] = useState<T>(() =>
    key ? (storage.get(key) ?? defaultInitialValue) : defaultInitialValue,
  )
  const syncedSetValue = useCallback(
    (value: SetStateAction<T>) => {
      if (typeof value === 'function') {
        setValue(prev => {
          const newValue = (value as (prev: T) => T)(prev)
          if (key) {
            storage.set(key, newValue)
          }
          return newValue
        })
      } else {
        setValue(value)
        if (key) {
          storage.set(key, value)
        }
      }
    },
    [key, storage],
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
  /**
   * The rows are offers rather than the only answers, so Enter sends what has been typed unless a
   * row was picked with the arrow keys.
   */
  openEnded: boolean
}

export interface MessageInputProps {
  className?: string
  showDivider?: boolean
  maxRows?: number
  onSendChatMessage: (msg: string) => void
  /**
   * Called after any submission the input acts on — a sent message, a run command, or a whisper
   * reply — whatever branch handled it. Owners use it to treat submitting as reading the surface:
   * typing an answer at the bottom of a conversation counts as being caught up with it, so the view
   * moves to the newest message and the surface is marked read no matter what was submitted.
   */
  onSubmitted?: () => void
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
  /**
   * Puts the input into reply mode for `target`, keeping whatever is typed. Does nothing for an
   * input without `commands`, since there is no surface to answer in.
   */
  startReply: (target: ReplyTarget) => void
}

// A plain function component rather than a forwardRef or a React.memo one: react-dom only
// refreshes `useEffectEvent` handlers for plain function-component fibers, so either wrapper would
// leave `onSelectionChange` frozen at its mount-time closure.
export function MessageInput({
  className,
  showDivider,
  maxRows = 20,
  storageKey,
  mentionableUsers,
  baseMentionableUsers,
  commands,
  onSendChatMessage,
  onSubmitted,
  ref,
}: MessageInputProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const user = useSelfUser()
  const chatRestriction = useAppSelector(s => s.auth.self?.restrictions.get(RestrictionKind.Chat))
  const combinedStorageKey = user && storageKey ? `${user.id}-${storageKey}` : undefined
  const [message, setMessage] = useStorageSyncedState<string>(
    messageInputMap,
    '',
    combinedStorageKey,
  )
  const [replyTarget, setReplyTarget] = useStorageSyncedState<ReplyTarget | undefined>(
    replyTargetMap,
    undefined,
    combinedStorageKey,
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const [containerElem, setContainerElem] = useState<HTMLDivElement | null>(null)

  const [typeahead, setTypeahead] = useState<ActiveTypeahead | undefined>(undefined)
  const [activeIndex, setActiveIndex] = useState(0)
  // Whether the highlight has been moved with the arrow keys since the palette opened, which is
  // what picks a row out of the offers an open-ended argument makes.
  const [pickedRow, setPickedRow] = useState(false)
  const [paletteOpen, openPalette, closePalette] = usePopoverController()
  // Guards suggestions that load asynchronously against the caret having moved on by the time
  // they arrive
  const latestRequestRef = useRef(0)
  const listId = useId()

  // Every way a palette closes runs through here, so the next one to open starts on its first row
  // with nothing picked rather than wherever the last one was left.
  const resetPalette = () => {
    setActiveIndex(0)
    setPickedRow(false)
    closePalette()
  }

  // Clearing the input programmatically moves the caret without a `selectionchange` event, so
  // what was derived from the old caret position has to be dropped by hand.
  const clearInput = () => {
    latestRequestRef.current += 1
    setTypeahead(undefined)
    resetPalette()
    setMessage('')
  }

  /**
   * Locks the input to whispering `target` back: from here on everything in it is the reply's
   * text, with a chip naming them in front of it, until the reply is sent or the chip is cleared.
   */
  const enterReplyMode = (target: ReplyTarget) => {
    // A palette open at this point was derived with commands on offer, and — when reply mode is
    // entered from the reply command — for text that is about to be taken back out of the input;
    // the next caret move derives one afresh.
    latestRequestRef.current += 1
    setTypeahead(undefined)
    resetPalette()
    setReplyTarget(target)
    inputRef.current?.focus()
  }

  /** Drops back to composing an ordinary message, leaving whatever is typed where it is. */
  const leaveReplyMode = () => {
    setReplyTarget(undefined)
    inputRef.current?.focus()
  }

  /**
   * Takes text the user typed, or accepted from a palette row, into the input. An input that has
   * come to read as the reply command turns into reply mode instead of holding the command: the
   * target is snapshotted the moment that happens, so a whisper arriving while the message is
   * being written can't redirect it.
   */
  const commitMessage = (next: string) => {
    if (commands && !replyTarget) {
      const replyMatch = matchReplyCommand(next)
      if (replyMatch?.hasSeparator) {
        const target = resolveReplyTarget(store.getState())
        if (!target) {
          commands.emit({ kind: 'info', content: noReplyTargetLine(t) })
          clearInput()
          return
        }

        enterReplyMode(target)
        setMessage(replyMatch.rest)
        return
      }
    }

    setMessage(next)
  }

  const [anchorX, anchorY] = useElemAnchorPosition(containerElem, 'left', 'top')

  // The first provider to claim the caret owns the palette, so the more specific ones come first.
  // Reply mode offers no commands, since everything typed there is the reply's text; mentions and
  // emotes still complete.
  const providers: TypeaheadProvider[] = []
  if (commands && !replyTarget) {
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
    startReply: target => {
      if (!commands) {
        return
      }
      enterReplyMode(target)
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
      resetPalette()
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
        // was left. A provider can change without the palette closing in between, e.g. backspacing
        // out of a command's argument and back into its name.
        setActiveIndex(0)
        setPickedRow(false)
      }
      setTypeahead({
        provider,
        start: match.start,
        matchedText: match.matchedText,
        suggestions,
        submitOnExact: !!match.submitOnExact,
        spaceAcceptsSingle: !!match.spaceAcceptsSingle,
        openEnded: !!match.openEnded,
      })

      if (suggestions.length > 0) {
        openPalette(event)
      } else {
        resetPalette()
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
    commitMessage(event.target.value)
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
  // NOTE: The suggestion list can shrink while an index further down is active, so the index is
  // narrowed to the rows that are actually there before it is handed down to the list.
  const clampedActiveIndex = Math.min(activeIndex, Math.max(suggestions.length - 1, 0))
  const activeSuggestion = suggestions[clampedActiveIndex]
  const paletteShowing = paletteOpen && suggestions.length > 0

  const acceptSuggestion = (suggestion: TypeaheadSuggestion) => {
    if (!typeahead) {
      return
    }

    const { provider, start, matchedText } = typeahead
    resetPalette()
    provider.onAccept?.(suggestion)
    commitMessage(
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
      // Two ways what is in the input is already the answer: it spells the highlighted suggestion
      // out, or it sits in an argument whose rows are only offers, where the typed token is a
      // value in its own right. Moving the highlight is the exception to the latter, since that
      // picks a row to take.
      const sendAsTyped =
        (typeahead.submitOnExact && activeSuggestion.exact) || (typeahead.openEnded && !pickedRow)
      if (sendAsTyped) {
        resetPalette()
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

      // Reply mode is only ever entered from a surface that runs commands, so its emitter is
      // there to answer a failed send with. Nothing typed in reply mode is a command: the whole
      // input is the whisper's text, a leading slash included.
      if (replyTarget && commands) {
        sendReply(replyTarget, toSend, {
          context: commands.context,
          dispatch,
          t,
          emit: commands.emit,
        })
        // One composition, one reply: the next reply command locks a target afresh.
        clearInput()
        leaveReplyMode()
        onSubmitted?.()
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
          enterReplyMode,
        })
        if (result.kind === 'text') {
          onSendChatMessage(result.text)
        }
        clearInput()
        onSubmitted?.()
        return
      }

      onSendChatMessage(toSend)
      clearInput()
      onSubmitted?.()
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
        leadingContent={
          replyTarget ? <ReplyChip name={replyTarget.name} onClear={leaveReplyMode} /> : undefined
        }
        trailingIcons={[
          <EmotePickerButton key='emotes' disabled={!!chatRestriction} onInsert={insertAtCaret} />,
        ]}
        inputProps={{
          autoComplete: 'off',
          // No explicit role and no `aria-expanded`: ARIA in HTML allows neither on a `textarea`,
          // whose implicit `textbox` role has no expanded state. Whether a palette is showing and
          // which row it holds is carried by `aria-controls` and `aria-activedescendant`.
          'aria-autocomplete': 'list',
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
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            // Deliberately not prevented: the popover's key boundary skips events whose default is
            // already prevented, and the suggestion list needs the key to move its highlight.
            if (paletteShowing) {
              setPickedRow(true)
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
          } else if (event.key === 'Backspace') {
            // The reply chip sits in front of the text, so the backspace that would delete nothing
            // at all deletes the chip instead. An actual selection is content to delete, not a
            // caret resting against the chip.
            const input = inputRef.current
            if (replyTarget && input?.selectionStart === 0 && input.selectionEnd === 0) {
              event.preventDefault()
              leaveReplyMode()
            }
          } else if (event.key === 'Escape') {
            // An open palette owns Escape until it closes. The surrounding key listener boundary
            // skips events whose default is prevented, so the surface doesn't also act on this
            // one.
            if (replyTarget && !paletteShowing) {
              event.preventDefault()
              leaveReplyMode()
            }
          }
        }}
        onEnterKeyDown={onEnterKeyDown}
        onChange={onChange}
      />

      <Popover
        open={paletteOpen}
        onDismiss={resetPalette}
        anchorX={anchorX ?? 0}
        anchorY={(anchorY ?? 0) - 8}
        originX='left'
        originY='bottom'
        // Keep the focus in the message input when the suggestions open so the user can keep
        // typing.
        focusOnMount={false}>
        <SuggestionList
          id={listId}
          role='listbox'
          dense={true}
          virtualFocus={true}
          activeIndex={clampedActiveIndex}
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
