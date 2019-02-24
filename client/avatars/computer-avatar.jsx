import React from 'react'

import { ImageAvatar } from './avatar.jsx'

import ComputerIcon from '../icons/material/ic_memory_black_24px.svg'

export default props => (
  <ImageAvatar as="i" {...props}>
    <ComputerIcon />
  </ImageAvatar>
)
