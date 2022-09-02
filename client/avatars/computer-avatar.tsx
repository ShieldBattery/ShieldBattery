import React from 'react'
import ComputerIcon from '../icons/material/memory-24px.svg'
import { IconAvatar, IconContainer } from './avatar'

export default (props: { className?: string }) => (
  <IconContainer {...props}>
    <IconAvatar as={ComputerIcon} />
  </IconContainer>
)
