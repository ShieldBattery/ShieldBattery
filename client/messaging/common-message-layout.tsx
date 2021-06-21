import React from 'react'
import styled from 'styled-components'
import { amberA100 } from '../styles/colors'
import { body2 } from '../styles/typography'
import { ConnectedUsername } from './connected-username'
import {
  InfoImportant,
  SeparatedInfoMessage,
  Separator,
  TimestampMessageLayout,
} from './message-layout'

const newDayFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'long',
  day: '2-digit',
})

const Username = styled.span`
  ${body2};

  margin-right: 8px;

  color: ${amberA100};
  line-height: inherit;
`

const Text = styled.span`
  line-height: inherit;
  word-wrap: break-word;
  overflow-wrap: break-word;
  overflow: hidden;
`

export const TextMessageDisplay = React.memo<{ userId: number; time: number; text: string }>(
  props => {
    const { userId, time, text } = props
    return (
      <TimestampMessageLayout time={time}>
        <Username>
          <ConnectedUsername userId={userId} />
        </Username>
        <Separator aria-hidden={true}>{': '}</Separator>
        <Text>{text}</Text>
      </TimestampMessageLayout>
    )
  },
)

export const NewDayMessage = React.memo<{ time: number }>(props => {
  const { time } = props
  return (
    <SeparatedInfoMessage>
      <span>
        Day changed to <InfoImportant>{newDayFormat.format(time)}</InfoImportant>
      </span>
    </SeparatedInfoMessage>
  )
})
