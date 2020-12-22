import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import { amberA100, colorTextFaint, colorDividers } from '../styles/colors'
import { Body1Old, Body2Old, CaptionOld } from '../styles/typography'

const localeTimeSupported = !!Date.prototype.toLocaleTimeString
function getLocalTime(date) {
  if (localeTimeSupported) {
    return date.toLocaleTimeString(navigator.language, {
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  // Internationalization isn't supported, so we'll just format to American time. DEAL WITH IT.
  let hour = date.getHours()
  const isPm = hour >= 12
  hour = isPm ? hour - 12 : hour
  if (hour === 0) {
    hour = 12
  }
  let minute = '' + date.getMinutes()
  if (minute.length === 1) {
    minute = '0' + minute
  }
  return hour + ':' + minute + ' ' + (isPm ? 'PM' : 'AM')
}

const longTimestamp = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
})

const Timestamp = styled(CaptionOld)`
  flex-shrink: 0;
  margin: 0;
  margin-right: 8px;
  line-height: inherit;
  color: ${colorTextFaint};
`

export const ChatTimestamp = props => (
  <Timestamp title={longTimestamp.format(props.time)}>
    {getLocalTime(new Date(props.time))}
  </Timestamp>
)
ChatTimestamp.propTypes = {
  time: PropTypes.number.isRequired,
}

const MessageContainer = styled(Body1Old)`
  display: flex;
  align-items: flex-start;
  line-height: 20px;
  min-height: 20px;
  padding: 0 8px 4px 8px;
`

export const ChatMessageLayout = props => {
  return (
    <MessageContainer as='div' className={props.className}>
      <ChatTimestamp time={props.time} />
      {props.children}
    </MessageContainer>
  )
}
ChatMessageLayout.propTypes = {
  time: PropTypes.number.isRequired,
  className: PropTypes.string,
}

const Username = styled(Body2Old)`
  flex-shrink: 0;
  color: ${amberA100};
  line-height: inherit;
  padding-right: 8px;
`

const Text = styled.span`
  flex-grow: 1;
  line-height: inherit;
  padding-left: 8px;
  min-width: 0;
  word-wrap: break-word;
  overflow-wrap: break-word;
  overflow: hidden;
`

export class ChatMessage extends React.Component {
  static propTypes = {
    user: PropTypes.string.isRequired,
    time: PropTypes.number.isRequired,
    text: PropTypes.string.isRequired,
  }

  shouldComponentUpdate(nextProps) {
    return (
      nextProps.user !== this.props.user ||
      nextProps.time !== this.props.time ||
      nextProps.text !== this.props.text
    )
  }

  render() {
    const { user, time, text } = this.props

    return (
      <ChatMessageLayout time={time}>
        <Username>{user}</Username>
        <Text>{text}</Text>
      </ChatMessageLayout>
    )
  }
}

const InfoDivider = styled.hr`
  border: none;
  border-top: 1px solid ${colorDividers};
  margin: 0;
`

const InfoDividerLeft = styled(InfoDivider)`
  width: 72px;
  margin-right: 8px;
`

const InfoDividerRight = styled(InfoDivider)`
  flex-grow: 1;
  margin-left: 8px;
`

export const InfoMessageLayout = props => {
  return (
    <MessageContainer className={props.className}>
      <InfoDividerLeft />
      {props.children}
      <InfoDividerRight />
    </MessageContainer>
  )
}
InfoMessageLayout.propTypes = {
  className: PropTypes.string,
}
