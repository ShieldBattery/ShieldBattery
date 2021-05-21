import styled from 'styled-components'
import { shadow3dp } from '../material/shadows'
import { background500 } from '../styles/colors'

export default styled.div`
  ${shadow3dp};

  width: 96px;
  padding-bottom: 8px;

  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  justify-content: flex-start;
  align-items: center;

  background-color: ${background500};
  overflow: hidden;
`
