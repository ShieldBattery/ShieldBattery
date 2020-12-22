import styled from 'styled-components'
import { rgba } from 'polished'

import { shadow3dp } from '../material/shadows'
import { blue800 } from '../styles/colors.ts'

export default styled.div`
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  justify-content: flex-start;
  align-items: center;
  width: 96px;
  padding-bottom: 8px;
  ${shadow3dp};
  background-color: ${rgba(blue800, 0.3)};
  overflow: hidden;
`
