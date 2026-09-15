import * as React from 'react'
import { useContext } from 'react'
import styled from 'styled-components'
import { useContextMenu } from '../dom/use-context-menu'
import { useNavigationTracker } from '../navigation/navigation-tracker'
import { useAppSelector } from '../redux-hooks'
import { titleSmall } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { ConnectedUserContextMenu } from '../users/user-context-menu'
import { navigateToWhisper } from '../whispers/action-creators'
import { ChatContext } from './chat-context'
import { parseMessageText } from './common-message-layout'
import { useMentionFilterClick } from './mention-hooks'
import { Separator, TimestampMessageLayout } from './message-layout'
import { CommonWhisperEchoMessage } from './message-records'
import { RolledOutcomeLine } from './rolled-outcome-line'

/** Which way the whisper went: towards the user for an incoming one, away for an outgoing one. */
const INCOMING_ARROW = '← '
const OUTGOING_ARROW = '→ '

/** The arrow the line opens with, in the colour that marks the whole line as a whisper. */
const EchoGlyph = styled.span`
  line-height: inherit;

  color: var(--color-purple70);
`

/** The `*` that opens an action line, carrying the arrow's colour. */
const EchoEmoteGlyph = styled(EchoGlyph)`
  font-style: italic;
`

const EchoUsername = styled(ConnectedUsername)`
  ${titleSmall};

  margin-right: 8px;
  padding-block: 4px;

  color: var(--color-purple80);
  line-height: inherit;
`

/**
 * The name in an action line, which reads `* Name action`. A real space separates it from the text,
 * so it carries no margin of its own.
 */
const EchoEmoteUsername = styled(EchoUsername)`
  margin-right: 0;

  font-style: italic;
`

const EchoText = styled.span`
  line-height: inherit;
  word-wrap: break-word;
  overflow-wrap: break-word;
  overflow: hidden;
  white-space: pre-wrap;

  color: var(--color-purple95);
`

const EchoEmoteText = styled(EchoText)`
  font-style: italic;
`

/** The line as a whole opens the conversation the whisper belongs to. */
const EchoLine = styled(TimestampMessageLayout)`
  cursor: pointer;
`

export interface WhisperEchoMessageProps {
  message: CommonWhisperEchoMessage
}

/**
 * A whisper shown in a surface that isn't its own conversation, so it can be read (and answered)
 * without leaving what the user was doing. Clicking the line opens the conversation, and
 * right-clicking it offers the other user's menu.
 */
export function WhisperEchoMessage({ message }: WhisperEchoMessageProps) {
  const { direction, counterpartId, text, emote, outcome, time } = message
  const filterClick = useMentionFilterClick()
  const { UserMenu, disallowMentionInteraction } = useContext(ChatContext)
  const { onNavigation } = useNavigationTracker()
  const { onContextMenu, contextMenuPopoverProps } = useContextMenu()
  const counterpartName = useAppSelector(s => s.users.byId.get(counterpartId)?.name)

  // An echo is a view of a whisper rather than a message in this conversation, so neither a
  // mention of the user nor a lobby link in it acts on the surface it's shown in. An outcome
  // line's wording is composed from the outcome, not parsed out of `text`.
  const parsed = outcome
    ? undefined
    : parseMessageText(text, {
        filterClick,
        UserMenu,
        interactive: !disallowMentionInteraction,
      })

  const onClick = (event: React.MouseEvent) => {
    // Everything within the line that can be acted on in its own right keeps its click: the name
    // opens the user overlay, a link opens what it points at.
    const interactiveTarget = (event.target as Element).closest('a, button, [tabindex]')
    if (interactiveTarget !== null && interactiveTarget !== event.currentTarget) {
      return
    }

    // A click that ends a drag across the text is the user selecting it, not asking to go anywhere.
    const selection = window.getSelection()
    if (selection !== null && !selection.isCollapsed) {
      return
    }

    if (counterpartName === undefined) {
      // The conversation's URL is built from the name, which isn't known yet; the name rendered
      // below is what asks for it.
      return
    }

    navigateToWhisper(counterpartId, counterpartName)
    onNavigation()
  }

  // An outcome is always announced as an action line, whatever flag the whisper carries.
  const isActionLine = emote === true || outcome !== undefined
  const UsernameComponent = isActionLine ? EchoEmoteUsername : EchoUsername
  const TextComponent = isActionLine ? EchoEmoteText : EchoText

  return (
    <>
      <EchoLine
        time={time}
        active={contextMenuPopoverProps.open}
        onClick={onClick}
        onContextMenu={onContextMenu}
        testId='whisper-echo'>
        <EchoGlyph>{direction === 'incoming' ? INCOMING_ARROW : OUTGOING_ARROW}</EchoGlyph>
        {isActionLine ? <EchoEmoteGlyph>{'* '}</EchoEmoteGlyph> : undefined}
        <UsernameComponent
          userId={counterpartId}
          filterClick={filterClick}
          UserMenu={UserMenu}
          interactive={!disallowMentionInteraction}
        />
        {isActionLine ? ' ' : <Separator>{': '}</Separator>}
        <TextComponent>
          {outcome ? <RolledOutcomeLine outcome={outcome} text={text} /> : parsed?.nodes}
        </TextComponent>
      </EchoLine>

      <ConnectedUserContextMenu
        userId={counterpartId}
        UserMenu={UserMenu}
        popoverProps={contextMenuPopoverProps}
      />
    </>
  )
}
