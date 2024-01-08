import { css } from 'styled-components'

/**
 * Styles that will cause any text within the container to be selectable (ending at the bounds
 * of the container).
 */
export const selectableTextContainer = css`
  user-select: contain;

  & * {
    user-select: text;
  }
`
