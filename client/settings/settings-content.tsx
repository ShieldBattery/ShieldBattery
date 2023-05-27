import styled from 'styled-components'

export const FormContainer = styled.div<{ $doubleColumn?: boolean }>`
  display: grid;
  grid-template-columns: ${props => (props.$doubleColumn ? '1fr 1fr' : '1fr')};
  column-gap: 40px;
  width: 100%;
`

export const Spacer = styled.div`
  width: 100%;
  height: 32px;
`
