import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import { InfoMessageLayout, TimestampMessageLayout } from '../messaging/message-layout'
import { blue100, blue200, colorTextFaint, colorTextSecondary } from '../styles/colors'
import { body2 } from '../styles/typography'
import {
  ChatMessage,
  JoinChannelMessageRecord,
  LeaveChannelMessageRecord,
  NewChannelOwnerMessageRecord,
  SelfJoinChannelMessageRecord,
} from './chat-message-records'

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

interface BaseMessageProps {
  record: ChatMessage
}

class BaseMessage extends React.Component<BaseMessageProps> {
  static propTypes = {
    record: PropTypes.object.isRequired,
  }

  shouldComponentUpdate(nextProps: BaseMessageProps) {
    return this.props.record !== nextProps.record
  }
}

export class JoinChannelMessage extends BaseMessage {
  render() {
    const { time, user } = this.props.record as JoinChannelMessageRecord
    return (
      <SystemMessage time={time}>
        <span>
          <SystemImportant>{user}</SystemImportant> has joined the channel
        </span>
      </SystemMessage>
    )
  }
}

export class LeaveChannelMessage extends BaseMessage {
  render() {
    const { time, user } = this.props.record as LeaveChannelMessageRecord
    return (
      <SystemMessage time={time}>
        <span>
          <SystemImportant>{user}</SystemImportant> has left the channel
        </span>
      </SystemMessage>
    )
  }
}

export class NewChannelOwnerMessage extends BaseMessage {
  render() {
    const { time, newOwner } = this.props.record as NewChannelOwnerMessageRecord
    return (
      <SystemMessage time={time}>
        <span>
          <SystemImportant>{newOwner}</SystemImportant> is the new owner of the channel
        </span>
      </SystemMessage>
    )
  }
}

export class SelfJoinChannelMessage extends BaseMessage {
  render() {
    const { channel } = this.props.record as SelfJoinChannelMessageRecord
    return (
      <SeparatedInfoMessage>
        <span>
          You joined <InfoImportant>#{channel}</InfoImportant>
        </span>
      </SeparatedInfoMessage>
    )
  }
}
