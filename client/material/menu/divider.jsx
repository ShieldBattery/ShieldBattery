import React from 'react'
import styled from 'styled-components'

import { colorDividers } from '../../styles/colors'

const StyledDivider = styled.div`
  width: 100%;
  height: 1px;
  margin: 8px 0;
  background-color: ${colorDividers};
`

const Divider = props => {
  return <StyledDivider />
}

export default Divider
