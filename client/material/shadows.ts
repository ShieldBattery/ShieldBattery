import { css } from 'styled-components'

const shadowKeyUmbraOpacity = 0.2
const shadowKeyPenumbraOpacity = 0.14
const shadowAmbientOpacity = 0.12
const shadowOutlineOpacity = 0.32

// eslint-disable-next-line max-params
function shadowDef(
  depth: number,
  uOff: number,
  uBlur: number,
  uSpread: number,
  pOff: number,
  pBlur: number,
  pSpread: number,
  aOff: number,
  aBlur: number,
  aSpread: number,
) {
  return `
    0px ${uOff}px ${uBlur}px ${uSpread}px rgb(from var(--color-grey-blue10) r g b / ${shadowKeyUmbraOpacity}),
    0px ${pOff}px ${pBlur}px ${pSpread}px rgb(from var(--color-grey-blue20) r g b / ${shadowKeyPenumbraOpacity}),
    0px ${aOff}px ${aBlur}px ${aSpread}px rgb(from var(--color-blue10) r g b / ${shadowAmbientOpacity}),
    0px 0px 1px 1px rgb(from var(--color-blue80) r g b / ${shadowOutlineOpacity})
  `
}

export const shadowDef1dp = shadowDef(1, 2, 1, -1, 1, 1, 0, 1, 3, 0)
export const shadowDef3dp = shadowDef(3, 3, 3, -2, 3, 4, 0, 1, 8, 0)
export const shadowDef6dp = shadowDef(6, 3, 5, -1, 6, 10, 0, 1, 18, 0)
export const shadowDef8dp = shadowDef(8, 5, 5, -3, 8, 10, 1, 3, 14, 2)
export const shadowDef12dp = shadowDef(12, 7, 8, -4, 12, 17, 2, 5, 22, 4)

export type ShadowLevel = 0 | 1 | 3 | 6 | 8 | 12

const shadowsByDepth: Readonly<Record<ShadowLevel, string>> = {
  0: 'none',
  1: shadowDef1dp,
  3: shadowDef3dp,
  6: shadowDef6dp,
  8: shadowDef8dp,
  12: shadowDef12dp,
}

function shadow(depth: ShadowLevel) {
  return css`
    box-shadow: ${shadowsByDepth[depth]};
    z-index: ${depth};
  `
}

export const elevationZero = shadow(0)
export const elevationPlus1 = shadow(1)
export const elevationPlus2 = shadow(3)
export const elevationPlus3 = shadow(6)
export const elevationPlus4 = shadow(8)
export const elevationPlus5 = shadow(12)
