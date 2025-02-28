import styled, { css } from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { RaceChar } from '../../common/races'

export const blue10 = '#0f1624'
export const blue20 = '#102040'
export const blue30 = '#102a5f'
export const blue40 = '#0d398b'
export const blue50 = '#1a59c6'
export const blue60 = '#2f77ec'
export const blue70 = '#4186f6'
export const blue80 = '#7eb1ff'
export const blue90 = '#8fbcff'
export const blue95 = '#bfd9ff'
export const blue99 = '#e6f0ff'

export const amber10 = '#1b1509'
export const amber20 = '#413001'
export const amber30 = '#7a5f1b'
export const amber40 = '#a87f08'
export const amber50 = '#eab516'
export const amber60 = '#ffc400'
export const amber70 = '#ffca3f'
export const amber80 = '#ffd982'
export const amber90 = '#ffdd90'
export const amber95 = '#ffe7b3'
export const amber99 = '#f8f0df'

export const purple10 = '#161428'
export const purple20 = '#281d3a'
export const purple30 = '#372452'
export const purple40 = '#4e3273'
export const purple50 = '#7653a4'
export const purple60 = '#9770c9'
export const purple70 = '#a782d6'
export const purple80 = '#c6a2f2'
export const purple90 = '#ceadf8'
export const purple95 = '#e4ceff'
export const purple99 = '#f8ecf8'

export const mint10 = '#101a1a'
export const mint20 = '#14332d'
export const mint30 = '#00493f'
export const mint40 = '#006d5e'
export const mint50 = '#38ac97'
export const mint60 = '#67e0c7'
export const mint70 = '#76e4cc'
export const mint80 = '#8df0da'
export const mint90 = '#98f3dd'
export const mint95 = '#bdf6e8'
export const mint99 = '#dff7f7'

export const indigo10 = '#111526'
export const indigo20 = '#1a1a3d'
export const indigo30 = '#1f1d55'
export const indigo40 = '#2a2472'
export const indigo50 = '#403997'
export const indigo60 = '#524bb3'
export const indigo70 = '#625ec0'
export const indigo80 = '#918fe9'
export const indigo90 = '#a8a7f5'
export const indigo95 = '#c9c9fc'
export const indigo99 = '#ededfc'

export const greyBlue10 = '#161717'
export const greyBlue20 = '#1e222b'
export const greyBlue30 = '#252c3c'
export const greyBlue40 = '#333d53'
export const greyBlue50 = '#4f5d78'
export const greyBlue60 = '#677895'
export const greyBlue70 = '#7686a2'
export const greyBlue80 = '#9dadc9'
export const greyBlue90 = '#a9b9d2'
export const greyBlue95 = '#cbd6e8'
export const greyBlue99 = '#efeff0'

export const grey10 = '#1b1e22'
export const grey20 = '#252a31'
export const grey30 = '#353d45'
export const grey40 = '#505762'
export const grey50 = '#68717c'
export const grey60 = '#9198a1'
export const grey70 = '#b2bbc7'
export const grey80 = '#d3dae4'
export const grey90 = '#e0e7f0'
export const grey95 = '#ebf1fa'
export const grey99 = '#f5fbfe'

export const colorContainerLowest = '#131e30'
export const colorContainerLow = '#17223c'
export const colorContainer = '#182844'
export const colorContainerHigh = '#1b2c4b'
export const colorContainerHighest = '#1b3154'

export const colorError = '#ff6e6e'
export const colorSuccess = '#66bb6a'

export const THEME_CSS = css`
  --color-blue10: ${blue10};
  --color-blue20: ${blue20};
  --color-blue30: ${blue30};
  --color-blue40: ${blue40};
  --color-blue50: ${blue50};
  --color-blue60: ${blue60};
  --color-blue70: ${blue70};
  --color-blue80: ${blue80};
  --color-blue90: ${blue90};
  --color-blue95: ${blue95};
  --color-blue99: ${blue99};

  --color-amber10: ${amber10};
  --color-amber20: ${amber20};
  --color-amber30: ${amber30};
  --color-amber40: ${amber40};
  --color-amber50: ${amber50};
  --color-amber60: ${amber60};
  --color-amber70: ${amber70};
  --color-amber80: ${amber80};
  --color-amber90: ${amber90};
  --color-amber95: ${amber95};
  --color-amber99: ${amber99};

  --color-purple10: ${purple10};
  --color-purple20: ${purple20};
  --color-purple30: ${purple30};
  --color-purple40: ${purple40};
  --color-purple50: ${purple50};
  --color-purple60: ${purple60};
  --color-purple70: ${purple70};
  --color-purple80: ${purple80};
  --color-purple90: ${purple90};
  --color-purple95: ${purple95};
  --color-purple99: ${purple99};

  --color-mint10: ${mint10};
  --color-mint20: ${mint20};
  --color-mint30: ${mint30};
  --color-mint40: ${mint40};
  --color-mint50: ${mint50};
  --color-mint60: ${mint60};
  --color-mint70: ${mint70};
  --color-mint80: ${mint80};
  --color-mint90: ${mint90};
  --color-mint95: ${mint95};
  --color-mint99: ${mint99};

  --color-indigo10: ${indigo10};
  --color-indigo20: ${indigo20};
  --color-indigo30: ${indigo30};
  --color-indigo40: ${indigo40};
  --color-indigo50: ${indigo50};
  --color-indigo60: ${indigo60};
  --color-indigo70: ${indigo70};
  --color-indigo80: ${indigo80};
  --color-indigo90: ${indigo90};
  --color-indigo95: ${indigo95};
  --color-indigo99: ${indigo99};

  --color-grey-blue10: ${greyBlue10};
  --color-grey-blue20: ${greyBlue20};
  --color-grey-blue30: ${greyBlue30};
  --color-grey-blue40: ${greyBlue40};
  --color-grey-blue50: ${greyBlue50};
  --color-grey-blue60: ${greyBlue60};
  --color-grey-blue70: ${greyBlue70};
  --color-grey-blue80: ${greyBlue80};
  --color-grey-blue90: ${greyBlue90};
  --color-grey-blue95: ${greyBlue95};
  --color-grey-blue99: ${greyBlue99};

  --color-grey10: ${grey10};
  --color-grey20: ${grey20};
  --color-grey30: ${grey30};
  --color-grey40: ${grey40};
  --color-grey50: ${grey50};
  --color-grey60: ${grey60};
  --color-grey70: ${grey70};
  --color-grey80: ${grey80};
  --color-grey90: ${grey90};
  --color-grey95: ${grey95};
  --color-grey99: ${grey99};

  --theme-primary: var(--color-blue60);
  --theme-on-primary: var(--color-blue99);
  --theme-primary-container: var(--color-blue40);
  --theme-on-primary-container: var(--color-blue99);

  --theme-amber: var(--color-amber60);
  --theme-on-amber: var(--color-amber10);
  --theme-amber-container: var(--color-amber70);
  --theme-on-amber-container: var(--color-amber10);

  --theme-purple: var(--color-purple80);
  --theme-on-purple: var(--color-purple10);
  --theme-purple-container: var(--color-purple40);
  --theme-on-purple-container: var(--color-purple95);

  --theme-mint: var(--color-mint60);
  --theme-on-mint: var(--color-mint10);
  --theme-mint-container: var(--color-mint30);
  --theme-on-mint-container: var(--color-mint90);

  --theme-indigo: var(--color-indigo60);
  --theme-on-indigo: var(--color-indigo99);
  --theme-indigo-container: var(--color-indigo70);
  --theme-on-indigo-container: var(--color-indigo99);

  --theme-surface: var(--color-blue10);
  --theme-on-surface: var(--color-grey99);
  --theme-on-surface-variant: var(--color-blue95);

  --theme-outline: var(--color-grey-blue70);
  --theme-outline-variant: var(--color-grey-blue60);

  --theme-container-lowest: ${colorContainerLowest};
  --theme-container-low: ${colorContainerLow};
  --theme-container: ${colorContainer};
  --theme-container-high: ${colorContainerHigh};
  --theme-container-highest: ${colorContainerHighest};

  --theme-disabled-opacity: 0.38;

  --theme-error: ${colorError};
  --theme-success: ${colorSuccess};
`

// FIXME: delete these
/** Colors used for backgrounds (a muted grey-blue palette) */
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

// FIXME: delete this?
export const CardLayer = styled.div`
  background-color: var(--theme-container-low);
  --sb-color-background: var(--theme-container-low);
`
