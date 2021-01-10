import React from 'react'

import { IconContainer, IconAvatar } from './avatar'

import ComputerIcon from '../icons/material/ic_memory_black_24px.svg'

export default props => (
  <IconContainer {...props}>
    <IconAvatar as={ComputerIcon} />
  </IconContainer>
)
