import React from 'react'
import styled from 'styled-components'
import { colorDividers } from '../styles/colors'
import { body1 } from '../styles/typography'

const Container = styled.div<{ read: boolean }>`
  position: relative;
  padding: 16px 0;

  background-color: ${props => (props.read ? 'transparent' : 'rgba(255, 255, 255, 0.04)')};
`

const IconTextContainer = styled.div`
  display: flex;
  flex-direction: row;
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

const ActionsContainer = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: flex-end;
  margin-top: 16px;

  button {
    margin: 0;
  }
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
  read: boolean
  showDivider: boolean
}

export const ActionlessNotification = React.forwardRef<HTMLDivElement, NotificationProps>(
  (props, ref) => {
    return (
      <Container ref={ref} read={props.read}>
        <IconTextContainer>
          <IconContainer>{props.icon}</IconContainer>
          <TextContainer>{props.text}</TextContainer>
        </IconTextContainer>
        {props.showDivider && <Divider />}
      </Container>
    )
  },
)

export interface ActionableNotificationProps extends NotificationProps {
  actions: React.ReactNode[]
}

export const ActionableNotification = React.forwardRef<HTMLDivElement, ActionableNotificationProps>(
  (props, ref) => {
    return (
      <Container ref={ref} read={props.read}>
        <IconTextContainer>
          <IconContainer>{props.icon}</IconContainer>
          <TextContainer>{props.text}</TextContainer>
        </IconTextContainer>
        <ActionsContainer>{props.actions}</ActionsContainer>
        {props.showDivider && <Divider />}
      </Container>
    )
  },
)
