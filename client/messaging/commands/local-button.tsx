import styled from 'styled-components'

/**
 * An affordance typeset as part of the only-you text it sits in, rather than as a control of its
 * own: the browser's button chrome is stripped and the colour is inherited, so a `LocalStrong`
 * inside it takes whatever colour the surrounding line gives its strong parts.
 */
export const LocalLineButton = styled.button.attrs({ type: 'button' })`
  background: none;
  border: 0;
  margin: 0;
  padding: 0;
  color: inherit;
  text-align: inherit;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    text-decoration: underline;
  }

  &:focus-visible {
    outline: none;
  }

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
`
