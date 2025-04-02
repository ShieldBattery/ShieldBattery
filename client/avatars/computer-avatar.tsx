import React from 'react'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { withAttrs } from '../styles/styled-with-attrs'
import { IconAvatar, IconContainer } from './avatar'

const ComputerIcon = withAttrs(styled(MaterialIcon), { icon: 'memory' })``

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
