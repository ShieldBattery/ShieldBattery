import { css } from 'styled-components'
import { standardEasing } from './curve-constants'

export const fastOutSlowInShort = css`
  transition: background-color, border, box-shadow, color, fill, opacity, outline-color, transform;
  transition-duration: 250ms;
  transition-timing-function: ${standardEasing};
`

export const fastOutSlowInNormal = css`
  transition: background-color, border, box-shadow, color, fill, opacity, outline-color, transform;
  transition-duration: 400ms;
  transition-timing-function: ${standardEasing};
`
