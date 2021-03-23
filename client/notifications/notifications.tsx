import React from 'react'
import styled from 'styled-components'
import { colorDividers } from '../styles/colors'
import { body1 } from '../styles/typography'

const Container = styled.div<{ unread: boolean }>`
  position: relative;
  display: flex;
  padding: 16px 0;

  background-color: ${props => (props.unread ? 'rgba(255, 255, 255, 0.04)' : 'transparent')};
`

const IconContainer = styled.div`
  width: 36px;
  height: auto;
  margin-left: 16px;
  flex-grow: 0;
  flex-shrink: 0;
`

const TextContainer = styled.div`
  margin-left: 16px;
  margin-right: 16px;

  ${body1};
  flex-grow: 1;
`

const Divider = styled.div`
  height: 1px;
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 0;
  background-color: ${colorDividers};
`

export interface NotificationProps {
  icon: React.ReactNode
  text: React.ReactNode
  unread: boolean
  showDivider: boolean
}

export function ActionlessNotification(props: NotificationProps) {
  return (
    <Container unread={props.unread}>
      <IconContainer>{props.icon}</IconContainer>
      <TextContainer>{props.text}</TextContainer>
      {props.showDivider && <Divider />}
    </Container>
  )
}
