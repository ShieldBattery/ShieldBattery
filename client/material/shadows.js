import { css } from 'styled-components'
import * as shadowConstants from './shadow-constants'

export const shadowKeyUmbraOpacity = 0.2
export const shadowKeyPenumbraOpacity = 0.14
export const shadowAmbientOpacity = 0.12

const shadow = depth => {
  return css`
    box-shadow: ${shadowConstants[`shadowDef${depth}dp`]};
    z-index: ${depth};
  `
}

export const shadow1dp = shadow(1)
export const shadow2dp = shadow(2)
export const shadow3dp = shadow(3)
export const shadow4dp = shadow(4)
export const shadow5dp = shadow(5)
export const shadow6dp = shadow(6)
export const shadow7dp = shadow(7)
export const shadow8dp = shadow(8)
export const shadow9dp = shadow(9)
export const shadow10dp = shadow(10)
export const shadow11dp = shadow(11)
export const shadow12dp = shadow(12)
export const shadow13dp = shadow(13)
export const shadow14dp = shadow(14)
export const shadow15dp = shadow(15)
export const shadow16dp = shadow(16)
export const shadow17dp = shadow(17)
export const shadow18dp = shadow(18)
export const shadow19dp = shadow(19)
export const shadow20dp = shadow(20)
export const shadow21dp = shadow(21)
export const shadow22dp = shadow(22)
export const shadow23dp = shadow(23)
export const shadow24dp = shadow(24)
