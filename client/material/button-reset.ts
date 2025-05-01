import { css } from 'styled-components'

export const buttonReset = css`
  user-select: none;
  position: relative;
  outline: 0;
  border: none;
  font-style: inherit;
  font-variant: inherit;
  font-family: inherit;
  text-decoration: none;
  cursor: pointer;
  overflow: hidden;
  background-color: transparent;

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`
