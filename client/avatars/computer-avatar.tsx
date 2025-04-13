import React from 'react'
import { MaterialIcon } from '../icons/material/material-icon'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { IconAvatar, IconContainer } from './avatar'

const ComputerIcon = styledWithAttrs(MaterialIcon, { icon: 'memory' })``

export default function ComputerAvatar({
  className,
  size = 24,
}: {
  className?: string
  size?: number
}) {
  return (
    <IconContainer className={className}>
      <IconAvatar as={ComputerIcon} size={size} />
    </IconContainer>
  )
}
