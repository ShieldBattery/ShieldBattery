import styled from 'styled-components'

export default styled.div`
  display: grid;
  grid-template-columns: ${props => `repeat(${props.columnCount}, 1fr)`};
  grid-auto-rows: 1fr;
  grid-gap: ${props => `${props.padding}px`};

  // A trick to keep grid items at 1:1 aspect ratio while having variable widths
  &::before {
    content: '';
    width: 0;
    padding-bottom: 100%;
    grid-row: 1 / 1;
    grid-column: 1 / 1;
  }

  & > *:first-child {
    grid-row: 1 / 1;
    grid-column: 1 / 1;
  }
`
