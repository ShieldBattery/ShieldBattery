import React from 'react'
import PropTypes from 'prop-types'
import styled, { css } from 'styled-components'

import { amberA100, colorTextFaint, colorDividers } from '../styles/colors'
import { body1, body2, caption } from '../styles/typography'

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

/** Hidden separators that only show up in copy+paste. Should be aria-hidden as well. */
const Separator = styled.i`
  position: absolute;
  display: inline-block;
  opacity: 0;
  width: 0;
  line-height: inherit;
  white-space: pre;
`

// NOTE(tec27): These styles are done a bit oddly to ensure that message contents wraps in a
// pleasing way. We effectively pad everything and then push the timestamps into the padding. By
// doing this we also ensure copy+paste looks decent (instead of on separate lines)
const Timestamp = styled.span`
  ${caption};
  width: 72px;
  display: inline-block;
  padding-right: 8px;
  line-height: inherit;
  color: ${colorTextFaint};
  text-align: right;
`

export const ChatTimestamp = props => (
  <Timestamp title={longTimestamp.format(props.time)}>
    <Separator aria-hidden={true}>[</Separator>
    {getLocalTime(new Date(props.time))}
    <Separator aria-hidden={true}>] </Separator>
  </Timestamp>
)
ChatTimestamp.propTypes = {
  time: PropTypes.number.isRequired,
}

const messageContainerBase = css`
  ${body1};

  width: 100%;
  position: relative;
  min-height: 20px;
  padding: 4px 8px;

  line-height: 20px;
`

const MessageContainer = styled.div`
  ${messageContainerBase};
  ${body1};

  padding: 4px 8px 4px 72px;

  line-height: 20px;
  text-indent: -72px;
`

export const ChatMessageLayout = props => {
  return (
    <MessageContainer className={props.className} role='document'>
      <ChatTimestamp time={props.time} />
      {props.children}
    </MessageContainer>
  )
}
ChatMessageLayout.propTypes = {
  time: PropTypes.number.isRequired,
  className: PropTypes.string,
}

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

export class TextMessageDisplay extends React.Component {
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
        <Separator aria-hidden={true}>{': '}</Separator>
        <Text>{text}</Text>
      </ChatMessageLayout>
    )
  }
}

const InfoMessageContainer = styled.div`
  ${messageContainerBase};
  display: flex;
`

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
    <InfoMessageContainer className={props.className}>
      <InfoDividerLeft />
      {props.children}
      <InfoDividerRight />
    </InfoMessageContainer>
  )
}
InfoMessageLayout.propTypes = {
  className: PropTypes.string,
}
