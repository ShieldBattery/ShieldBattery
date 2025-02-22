import styled from 'styled-components'
import { colorTextSecondary } from '../styles/colors'
import { labelMedium } from '../styles/typography'

export const FormContainer = styled.div`
  width: 100%;

  display: flex;
  flex-direction: column;
  gap: 32px;
`

export const SectionOverline = styled.div`
  ${labelMedium};
  color: ${colorTextSecondary};
`
