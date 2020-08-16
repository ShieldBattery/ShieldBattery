import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import { ChatMessageLayout, InfoMessageLayout } from './message.jsx'

import { blue100, blue200, colorTextSecondary, colorTextFaint } from '../styles/colors'
import { Body2 } from '../styles/typography'

const SystemMessage = styled(ChatMessageLayout)`
  color: ${blue100};
`

const SystemImportant = styled(Body2)`
  line-height: inherit;
  color: ${blue200};
`

const InfoImportant = styled(Body2)`
  line-height: inherit;
  color: ${colorTextSecondary};
`

const SeparatedInfoMessage = styled(InfoMessageLayout)`
  display: flex;
  align-items: center;
  margin-top: 4px;
  margin-bottom: 4px;
  color: ${colorTextFaint};
`

class BaseMessage extends React.Component {
  static propTypes = {
    record: PropTypes.object.isRequired,
  }

  shouldComponentUpdate(nextProps) {
    return this.record !== nextProps.record
  }
}

export class JoinChannelMessage extends BaseMessage {
  render() {
    const { time, user } = this.props.record
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
    const { time, user } = this.props.record
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
    const { time, newOwner } = this.props.record
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
    const { channel } = this.props.record
    return (
      <SeparatedInfoMessage>
        <span>
          You joined <InfoImportant>#{channel}</InfoImportant>
        </span>
      </SeparatedInfoMessage>
    )
  }
}

export class UserOnlineMessage extends BaseMessage {
  render() {
    const { time, user } = this.props.record
    return (
      <SystemMessage time={time}>
        <span>
          &gt;&gt; <SystemImportant>{user}</SystemImportant> has come online
        </span>
      </SystemMessage>
    )
  }
}

export class UserOfflineMessage extends BaseMessage {
  render() {
    const { time, user } = this.props.record
    return (
      <SystemMessage time={time}>
        <span>
          &lt;&lt; <SystemImportant>{user}</SystemImportant> has gone offline
        </span>
      </SystemMessage>
    )
  }
}
