import React from 'react'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconAvatar, IconContainer } from './avatar'

const ComputerIcon = styled(MaterialIcon).attrs({ icon: 'memory' })``

export default (props: { className?: string }) => (
  <IconContainer {...props}>
    <IconAvatar as={ComputerIcon} />
  </IconContainer>
)
