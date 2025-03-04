import styled from 'styled-components'

export const Divider = styled.div<{ $dense?: boolean }>`
  width: 100%;
  height: 1px;
  margin: ${props => (props.$dense ? '3px 0 4px' : '7px 0 8px')};
  background-color: var(--theme-outline-variant);
  flex-shrink: 0;
`
