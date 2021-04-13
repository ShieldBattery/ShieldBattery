import React from 'react'
import styled from 'styled-components'
import { InfoMessageLayout, TimestampMessageLayout } from '../messaging/message-layout'
import { blue100, blue200, colorTextFaint, colorTextSecondary } from '../styles/colors'
import { body2 } from '../styles/typography'

const SystemMessage = styled(TimestampMessageLayout)`
  color: ${blue200};
`

const SystemImportant = styled.span`
  ${body2};
  color: ${blue100};
  line-height: inherit;
`

const InfoImportant = styled.span`
  ${body2};
  color: ${colorTextSecondary};
  line-height: inherit;
`

const SeparatedInfoMessage = styled(InfoMessageLayout)`
  display: flex;
  align-items: center;
  margin-top: 4px;
  margin-bottom: 4px;
  color: ${colorTextFaint};
`

export const JoinChannelMessage = React.memo<{ time: number; user: string }>(props => {
  const { time, user } = props
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>{user}</SystemImportant> has joined the channel
      </span>
    </SystemMessage>
  )
})

export const LeaveChannelMessage = React.memo<{ time: number; user: string }>(props => {
  const { time, user } = props
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>{user}</SystemImportant> has left the channel
      </span>
    </SystemMessage>
  )
})

export const NewChannelOwnerMessage = React.memo<{ time: number; newOwner: string }>(props => {
  const { time, newOwner } = props
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>{newOwner}</SystemImportant> is the new owner of the channel
      </span>
    </SystemMessage>
  )
})

export const SelfJoinChannelMessage = React.memo<{ channel: string }>(props => {
  const { channel } = props
  return (
    <SeparatedInfoMessage>
      <span>
        You joined <InfoImportant>#{channel}</InfoImportant>
      </span>
    </SeparatedInfoMessage>
  )
})
