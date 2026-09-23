import styled from 'styled-components'

/**
 * The column every practice page lives in. The surrounding play page already centers content and
 * provides the top padding, so this only adds the vertical rhythm between a page's sections.
 */
export const PracticePageColumn = styled.div`
  width: 100%;
  padding: 24px 0;

  display: flex;
  flex-direction: column;
  gap: 24px;
`
