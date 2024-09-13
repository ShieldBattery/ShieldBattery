import React from 'react'
import { styled } from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon.js'
import { IconAvatar, IconContainer } from './avatar.js'

const ComputerIcon = styled(MaterialIcon).attrs({ icon: 'memory' })``

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
