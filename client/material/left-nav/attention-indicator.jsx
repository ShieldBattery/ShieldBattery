import styled from 'styled-components'

const AttentionIndicator = styled.div`
  width: 8px;
  height: 8px;
  position: absolute;
  left: 4px;
  top: calc(50% - 4px);

  border-radius: 50%;
  background-color: var(--color-amber80);
`

export default AttentionIndicator
