import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { LocalLineKind } from './commands/local-output'
import { LocalStrong } from './commands/local-strong'
import { InlineCardLoading } from './inline-card'
import { GutterLabel, Separator, SystemMessage, TimestampMessageLayout } from './message-layout'

/** Carries the system lines' colours, since an answer to a command reads as the app speaking. */
const InfoLine = styled(SystemMessage)`
  ${LocalStrong} {
    color: var(--color-blue95);
  }
`

/** Errors colour the whole line, strong parts included, so nothing in it reads as ordinary chat. */
const ErrorLine = styled(TimestampMessageLayout)`
  color: var(--theme-error);
`

/** Forwards the card's first text baseline to the gutter and resets the message hanging indent. */
const CardSlot = styled.span`
  display: inline-flex;
  vertical-align: baseline;
  max-width: 100%;
  text-indent: 0;

  /* Loading placeholders have no text baseline to align with. */
  &:has(${InlineCardLoading}) {
    vertical-align: top;
  }
`

export interface LocalLineMessageProps {
  kind: LocalLineKind
  content: React.ReactNode
}

/**
 * A line only the user who ran a command sees: what the command answered with, or why it was
 * refused. It sits on the same grid as the conversation's messages, with the gutter saying who can
 * see it where a message would carry a timestamp.
 */
export function LocalLineMessage({ kind, content }: LocalLineMessageProps) {
  const { t } = useTranslation()
  const gutter = (
    <GutterLabel>
      <Separator>[</Separator>
      {t('messaging.localLine.onlyYou', 'only you')}
      <Separator>] </Separator>
    </GutterLabel>
  )

  if (kind === 'card') {
    return (
      <TimestampMessageLayout gutter={gutter}>
        <CardSlot>{content}</CardSlot>
      </TimestampMessageLayout>
    )
  }

  const Line = kind === 'error' ? ErrorLine : InfoLine

  return (
    <Line gutter={gutter}>
      <span>{content}</span>
    </Line>
  )
}
