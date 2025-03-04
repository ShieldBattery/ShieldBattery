import styled, { css } from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { RaceChar } from '../../common/races'

export const blue10 = '#10151e'
export const blue20 = '#12203a'
export const blue30 = '#10295b'
export const blue40 = '#123a86'
export const blue50 = '#1a59c6'
export const blue60 = '#2f77ec'
export const blue70 = '#4c88ea'
export const blue80 = '#7eb1ff'
export const blue90 = '#91bbf9'
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

export const greyBlue10 = '#101725'
export const greyBlue20 = '#182031'
export const greyBlue30 = '#202d47'
export const greyBlue40 = '#2e3e5b'
export const greyBlue50 = '#495d82'
export const greyBlue60 = '#62789e'
export const greyBlue70 = '#748bb3'
export const greyBlue80 = '#9bb1d3'
export const greyBlue90 = '#abbeda'
export const greyBlue95 = '#c8d7ee'
export const greyBlue99 = '#dceeff'

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

export const colorContainerLowest = '#141d2a'
export const colorContainerLow = '#182237'
export const colorContainer = '#18273e'
export const colorContainerHigh = '#1c2b46'
export const colorContainerHighest = '#1c304f'

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

export const dialogScrimOpacity = 0.5

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

  --theme-grey-blue: var(--color-grey-blue60);
  --theme-on-grey-blue: var(--color-grey-blue99);
  --theme-grey-blue-container: var(--color-grey-blue40);
  --theme-on-grey-blue-container: var(--color-grey-blue95);

  --theme-surface: var(--color-blue10);
  --theme-on-surface: var(--color-grey99);
  --theme-on-surface-variant: var(--color-blue95);
  --theme-inverse-surface: var(--color-blue99);
  --theme-inverse-on-surface: var(--color-grey10);
  --theme-inverse-primary: var(--color-blue-40);
  --theme-inverse-amber: var(--color-amber-60);

  --theme-outline: var(--color-grey-blue60);
  --theme-outline-variant: var(--color-grey-blue50);

  --theme-container-lowest: ${colorContainerLowest};
  --theme-container-low: ${colorContainerLow};
  --theme-container: ${colorContainer};
  --theme-container-high: ${colorContainerHigh};
  --theme-container-highest: ${colorContainerHighest};

  --theme-disabled-opacity: 0.38;

  --theme-error: ${colorError};
  --theme-success: ${colorSuccess};

  --theme-positive: ${colorPositive};
  --theme-negative: ${colorNegative};

  --theme-color-zerg: ${colorZerg};
  --theme-color-protoss: ${colorProtoss};
  --theme-color-terran: ${colorTerran};
  --theme-color-random: ${colorRandom};

  --theme-dialog-scrim: var(--color-blue10);
  --theme-dialog-scrim-opacity: ${dialogScrimOpacity};
`

// FIXME: delete these
export const colorDividers = `rgba(255, 255, 255, 0.12)`
export const colorTextFaint = '#8998a9'
export const colorTextSecondary = '#cdddee'
export const colorTextPrimary = '#ffffff'
export const colorTextInvert = 'rgba(0, 0, 0, 0.87)'
export const colorTextInvertSecondary = 'rgba(0, 0, 0, 0.6)'

export function getRaceColor(race: RaceChar) {
  switch (race) {
    case 'z':
      return 'var(--theme-color-zerg)'
    case 'p':
      return 'var(--theme-color-protoss)'
    case 't':
      return 'var(--theme-color-terran)'
    case 'r':
      return 'var(--theme-color-random)'
    default:
      return assertUnreachable(race)
  }
}

// FIXME: delete this?
export const CardLayer = styled.div`
  background-color: var(--theme-container-low);
  --sb-color-background: var(--theme-container-low);
`
