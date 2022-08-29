import styled from 'styled-components'
import { colorDividers } from '../../styles/colors'

export const Divider = styled.div<{ $dense?: boolean }>`
  width: 100%;
  height: 1px;
  margin: ${props => (props.$dense ? '3px 0 4px' : '7px 0 8px')};
  background-color: ${colorDividers};
  flex-shrink: 0;
`
