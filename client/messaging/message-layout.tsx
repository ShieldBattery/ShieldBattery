import React from 'react'
import styled, { css } from 'styled-components'
import { longTimestamp, shortTimestamp } from '../i18n/date-formats'
import { Tooltip } from '../material/tooltip'
import {
  amberA100,
  blue100,
  blue200,
  colorDividers,
  colorTextFaint,
  colorTextSecondary,
} from '../styles/colors'
import { body1, body2, caption } from '../styles/typography'

/** Hidden separators that only show up in copy+paste. */
export const Separator = styled.i.attrs({ 'aria-hidden': true })`
  width: 1px;
  height: 100%;

  display: inline-block;
  line-height: inherit;
  opacity: 0;
  white-space: pre;
  pointer-events: none;
`

const StyledTooltip = styled(Tooltip)`
  display: inline;
`

// NOTE(tec27): These styles are done a bit oddly to ensure that message contents wraps in a
// pleasing way. We effectively pad everything and then push the timestamps into the padding. By
// doing this we also ensure copy+paste looks decent (instead of on separate lines)
const Timestamp = styled.span`
  ${caption};
  width: 72px;
  display: inline-block;
  /** 8px when we add 1px for the separator */
  padding-right: 7px;
  line-height: inherit;
  color: ${colorTextFaint};
  text-align: right;
`

interface MessageTimestampProps {
  time: number
}

export const MessageTimestamp = (props: MessageTimestampProps) => (
  <StyledTooltip text={longTimestamp.format(props.time)} position='top'>
    <Timestamp>
      <Separator>[</Separator>
      {shortTimestamp.format(props.time)}
      <Separator>] </Separator>
    </Timestamp>
  </StyledTooltip>
)

const messageContainerBase = css`
  ${body1};

  width: 100%;
  position: relative;
  min-height: 20px;
  padding: 4px 8px;

  line-height: 20px;
`

const MessageContainer = styled.div<{ $active?: boolean; $highlighted?: boolean }>`
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

  ${props => {
    let backgroundColor: string
    if (props.$highlighted) {
      backgroundColor = 'rgba(255, 255, 255, 0.20)'
    } else {
      backgroundColor = 'rgba(255, 255, 255, 0.08)'
    }

    if (props.$active) {
      return `
        background-color: ${backgroundColor};
      `
    }

    return `
      &:hover {
        background-color: ${backgroundColor};
      }
    `
  }}
`

interface TimestampMessageLayoutProps {
  time: number
  active?: boolean
  highlighted?: boolean
  className?: string
  children: React.ReactNode
  onContextMenu?: (event: React.MouseEvent) => void
}

export const TimestampMessageLayout = (props: TimestampMessageLayoutProps) => {
  return (
    <MessageContainer
      $active={props.active}
      $highlighted={props.highlighted}
      className={props.className}
      role='document'
      onContextMenu={props.onContextMenu}>
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
