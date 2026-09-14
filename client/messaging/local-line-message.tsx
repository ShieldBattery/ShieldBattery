import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { LocalLineKind } from './commands/local-output'
import { LocalStrong } from './commands/local-strong'
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

/**
 * Holds the block of UI a card line carries. The slot sits on the line beside the gutter label the
 * way message text would, with its top aligned to the label. Being an inline-block makes it a block
 * container of its own, so the line's hanging-indent `text-indent` has to be reset here or the
 * card's own text would inherit it.
 */
const CardSlot = styled.span`
  display: inline-block;
  vertical-align: top;
  max-width: 100%;
  text-indent: 0;
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
