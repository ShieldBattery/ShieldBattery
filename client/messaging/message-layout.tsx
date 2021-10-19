import React from 'react'
import styled, { css } from 'styled-components'
import {
  amberA100,
  blue100,
  blue200,
  colorDividers,
  colorTextFaint,
  colorTextSecondary,
} from '../styles/colors'
import { body1, body2, caption } from '../styles/typography'

const localeTimeSupported = !!Date.prototype.toLocaleTimeString
function getLocalTime(date: Date) {
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
export const Separator = styled.i`
  position: absolute;
  display: inline-block;
  top: -10000px;
  left: -10000px;
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

interface MessageTimestampProps {
  time: number
}

export const MessageTimestamp = (props: MessageTimestampProps) => (
  <Timestamp title={longTimestamp.format(props.time)}>
    <Separator aria-hidden={true}>[</Separator>
    {getLocalTime(new Date(props.time))}
    <Separator aria-hidden={true}>] </Separator>
  </Timestamp>
)

const messageContainerBase = css`
  ${body1};

  width: 100%;
  position: relative;
  min-height: 20px;
  padding: 4px 8px;

  line-height: 20px;
`

const MessageContainer = styled.div<{ $highlighted?: boolean }>`
  ${messageContainerBase};
  ${body1};

  padding: 4px 8px 4px 72px;

  line-height: 20px;
  text-indent: -72px;

  ${props => {
    if (!props.$highlighted) {
      return ''
    }

    return `
      background-color: rgba(255, 255, 255, 0.16);

      &::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        width: 2px;
        background-color: ${amberA100};
      }
    `
  }}
`

interface TimestampMessageLayoutProps {
  time: number
  $highlighted?: boolean
  className?: string
  children: React.ReactNode
}

export const TimestampMessageLayout = (props: TimestampMessageLayoutProps) => {
  return (
    <MessageContainer $highlighted={props.$highlighted} className={props.className} role='document'>
      <MessageTimestamp time={props.time} />
      {props.children}
    </MessageContainer>
  )
}

export const SystemMessage = styled(TimestampMessageLayout)`
  color: ${blue200};
`

export const SystemImportant = styled.span`
  ${body2};
  color: ${blue100};
  line-height: inherit;
`

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

interface InfoMessageLayoutProps {
  className?: string
  children: React.ReactNode
}

export const InfoMessageLayout = (props: InfoMessageLayoutProps) => {
  return (
    <InfoMessageContainer className={props.className}>
      <InfoDividerLeft />
      {props.children}
      <InfoDividerRight />
    </InfoMessageContainer>
  )
}

export const InfoImportant = styled.span`
  ${body2};
  color: ${colorTextSecondary};
  line-height: inherit;
`

export const SeparatedInfoMessage = styled(InfoMessageLayout)`
  display: flex;
  align-items: center;
  margin-top: 4px;
  margin-bottom: 4px;
  color: ${colorTextFaint};
`
