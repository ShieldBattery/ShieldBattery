import styled from 'styled-components'
import { RolledOutcome } from '../../common/rolled-outcomes'
import { SbUserId } from '../../common/users/sb-user-id'
import { BodyMedium, singleLine } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { parseMessageText } from './common-message-layout'
import { RolledOutcomeLine } from './rolled-outcome-line'

const PreviewText = styled(BodyMedium)`
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const PreviewAuthor = styled.span`
  color: var(--theme-on-surface);
`

/** The parts of a text message a preview line shows. */
export interface PreviewableMessage {
  from: SbUserId
  text: string
  emote?: boolean
  outcome?: RolledOutcome
}

/**
 * A one-line preview of a chat message, written the way chat writes it (`Name: text`, or
 * `* Name action` for an action line) but with nothing in it interactive.
 */
export function MessagePreviewLine({
  message,
  className,
}: {
  message: PreviewableMessage
  className?: string
}) {
  const author = (
    <PreviewAuthor>
      <ConnectedUsername userId={message.from} interactive={false} />
    </PreviewAuthor>
  )

  let line: React.ReactNode
  if (message.outcome) {
    line = (
      <>
        * {author} <RolledOutcomeLine outcome={message.outcome} text={message.text} />
      </>
    )
  } else {
    const content = parseMessageText(message.text, {
      interactive: false,
      allowJumboEmoji: false,
    }).nodes
    line = message.emote ? (
      <>
        * {author} {content}
      </>
    ) : (
      <>
        {author}: {content}
      </>
    )
  }

  return <PreviewText className={className}>{line}</PreviewText>
}
