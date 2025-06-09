import styled from 'styled-components'
import { singleLine, titleLarge } from '../styles/typography'

export const HomeSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

export const HomeSectionTitle = styled.div`
  ${titleLarge};
  ${singleLine};
`
