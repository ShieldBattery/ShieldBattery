import { css } from 'styled-components'
import { fastOutSlowIn } from './curve-constants'

export const fastOutSlowInShort = css`
  transition: all 250ms ${fastOutSlowIn};
`

export const fastOutSlowInNormal = css`
  transition: all 400ms ${fastOutSlowIn};
`
