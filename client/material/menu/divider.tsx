import React from 'react'
import styled from 'styled-components'
import { colorDividers } from '../../styles/colors'

const StyledDivider = styled.div`
  width: 100%;
  height: 1px;
  margin: 7px 0 8px;
  background-color: ${colorDividers};
`

const Divider = () => {
  return <StyledDivider />
}

export default Divider
