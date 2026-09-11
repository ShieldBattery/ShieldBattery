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
  const Line = kind === 'error' ? ErrorLine : InfoLine

  return (
    <Line
      gutter={
        <GutterLabel>
          <Separator>[</Separator>
          {t('messaging.localLine.onlyYou', 'only you')}
          <Separator>] </Separator>
        </GutterLabel>
      }>
      <span>{content}</span>
    </Line>
  )
}
