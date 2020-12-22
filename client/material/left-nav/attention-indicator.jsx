import styled from 'styled-components'
import { amberA200 } from '../../styles/colors.ts'

const AttentionIndicator = styled.div`
  width: 8px;
  height: 8px;
  position: absolute;
  left: 4px;
  top: calc(50% - 4px);

  border-radius: 50%;
  background-color: ${amberA200};
`

export default AttentionIndicator
