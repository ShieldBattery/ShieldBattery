import * as React from 'react'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useContextMenu } from '../dom/use-context-menu'
import { titleSmall } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { ConnectedUserContextMenu } from '../users/user-context-menu'
import { ChatContext } from './chat-context'
import { parseMessageText } from './common-message-layout'
import { useMentionFilterClick } from './mention-hooks'
import { Separator, TimestampMessageLayout } from './message-layout'
import { CommonWhisperEchoMessage } from './message-records'
import { RolledOutcomeLine } from './rolled-outcome-line'

/**
 * The label the line opens with, saying which way the whisper went, in the colour that marks the
 * whole line as a whisper.
 */
const EchoGlyph = styled.span`
  line-height: inherit;

  color: var(--color-purple70);
`

/** The `*` that opens an action line, carrying the direction label's colour. */
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

export interface WhisperEchoMessageProps {
  message: CommonWhisperEchoMessage
}

/**
 * A whisper shown in a surface that isn't its own conversation, so it can be read (and answered)
 * without leaving what the user was doing. Right-clicking the line offers the other user's menu.
 */
export function WhisperEchoMessage({ message }: WhisperEchoMessageProps) {
  const { direction, counterpartId, text, emote, outcome, time } = message
  const filterClick = useMentionFilterClick()
  const { UserMenu, disallowMentionInteraction } = useContext(ChatContext)
  const { onContextMenu, contextMenuPopoverProps } = useContextMenu()
  const { t } = useTranslation()

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

  // An outcome is always announced as an action line, whatever flag the whisper carries.
  const isActionLine = emote === true || outcome !== undefined
  const UsernameComponent = isActionLine ? EchoEmoteUsername : EchoUsername
  const TextComponent = isActionLine ? EchoEmoteText : EchoText

  return (
    <>
      <TimestampMessageLayout
        time={time}
        active={contextMenuPopoverProps.open}
        onContextMenu={onContextMenu}
        testId='whisper-echo'>
        <EchoGlyph>
          {direction === 'incoming'
            ? t('chat.whisperEcho.from', 'From:')
            : t('chat.whisperEcho.to', 'To:')}{' '}
        </EchoGlyph>
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
      </TimestampMessageLayout>

      <ConnectedUserContextMenu
        userId={counterpartId}
        UserMenu={UserMenu}
        popoverProps={contextMenuPopoverProps}
      />
    </>
  )
}
