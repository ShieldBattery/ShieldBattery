import styled from 'styled-components'
import { labelMedium } from '../styles/typography'

export const FormContainer = styled.div`
  width: 100%;

  display: flex;
  flex-direction: column;
  gap: 32px;
`

export const SectionOverline = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

export const SectionContainer = styled.div`
  display: flex;
  flex-direction: column;
`
