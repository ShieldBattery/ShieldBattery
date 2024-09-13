import { styled } from 'styled-components'
import { colorTextSecondary } from '../styles/colors.js'
import { overline } from '../styles/typography.js'

export const FormContainer = styled.div`
  width: 100%;

  display: flex;
  flex-direction: column;
  gap: 32px;
`

export const SectionOverline = styled.div`
  ${overline};
  color: ${colorTextSecondary};
`
