import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { RaceChar } from '../../common/races'

/* Primary color */
export const blue50 = '#e3f2fd'
export const blue100 = '#bbdefb'
export const blue200 = '#90caf9'
export const blue300 = '#64b5f6'
export const blue400 = '#42a5f5'
export const blue500 = '#2196f3'
export const blue600 = '#1e88e5'
export const blue700 = '#1976d2'
export const blue800 = '#1565c0'
export const blue900 = '#0d47a1'

/* Accent color */
export const amberA100 = '#ffe57f'
export const amberA200 = '#ffd740'
export const amberA400 = '#ffc400'
export const amberA700 = '#ffab00'

/* Greys (for backgrounds) */
/** @deprecated */
export const grey700 = '#505762'
/** @deprecated */
export const grey800 = '#353D45'
/** @deprecated */
export const grey850 = '#252A31'
/** @deprecated */
export const grey900 = '#1B1E22'

/** Colors used for backgrounds (a muted grey-blue palette) */
export const background50 = '#7B97BA'
export const background100 = '#6584AA'
export const background200 = '#577598'
export const background300 = '#466180'
export const background400 = '#30455F'
export const background500 = '#243951'
export const background600 = '#1D2F44'
export const background700 = '#142539'
export const background800 = '#0E1B2A'
export const background900 = '#091320'

/** Background colors used for accenting particularly prominent UI. */
export const backgroundSaturatedLight = '#02498C'
export const backgroundSaturatedDark = '#034078'

export const alphaDividers = 0.12
export const alphaDisabled = 0.5

export const colorText = '#ffffff'

export const colorDividers = `rgba(255, 255, 255, ${alphaDividers})`
export const colorTextFaint = '#8998a9'
export const colorTextSecondary = '#cdddee'
export const colorTextPrimary = '#ffffff'
export const colorTextInvert = 'rgba(0, 0, 0, 0.87)'
export const colorTextInvertSecondary = 'rgba(0, 0, 0, 0.6)'

export const colorBackground = background800
export const colorError = '#ff6e6e'
export const colorSuccess = '#66bb6a'

/** Color used to indicate something positive (e.g. winning). */
export const colorPositive = '#69f0ae'
/** Color used to indicate something negative (e.g. losing). */
export const colorNegative = '#e66060'

export const colorZerg = '#c1a3f5'
export const colorProtoss = '#ffe57f'
export const colorTerran = '#89bbf5'
export const colorRandom = '#f5a63d'

export function getRaceColor(race: RaceChar) {
  switch (race) {
    case 'z':
      return colorZerg
    case 'p':
      return colorProtoss
    case 't':
      return colorTerran
    case 'r':
      return colorRandom
    default:
      return assertUnreachable(race)
  }
}

export const dialogScrim = background900

export const CardLayer = styled.div`
  background-color: ${background400};
  --sb-bg-color: ${background400};
`
