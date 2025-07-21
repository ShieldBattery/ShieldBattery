import { meetsContrastGuidelines } from 'polished'
import { css } from 'styled-components'
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

export const purple10 = '#131120'
export const purple20 = '#2a1b3e'
export const purple30 = '#3a2056'
export const purple40 = '#592d83'
export const purple50 = '#7a37b5'
export const purple60 = '#9352cc'
export const purple70 = '#ac7fd8'
export const purple80 = '#c49be9'
export const purple90 = '#cda6ee'
export const purple95 = '#eacefd'
export const purple99 = '#f3ebf9'

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

export const grey10 = '#16181f'
export const grey20 = '#252a31'
export const grey30 = '#353d45'
export const grey40 = '#505762'
export const grey50 = '#68717c'
export const grey60 = '#9198a1'
export const grey70 = '#b2bbc7'
export const grey80 = '#d3dae4'
export const grey90 = '#e0e7f0'
export const grey95 = '#ebf1fa'
export const grey99 = '#edf7fe'

export const colorContainerLowest = '#141d2a'
export const colorContainerLow = '#182237'
export const colorContainer = '#18273e'
export const colorContainerHigh = '#1c2b46'
export const colorContainerHighest = '#1c304f'
// Colors that aren't intended to be used directly, but will be added to the container elevation
// hierarchy when inside a container (to ensure we can basically always e.g. put a card in a
// container and still have its bounds visible)
const colorContainerHighestPlus1 = '#1f3355'
const colorContainerHighestPlus2 = '#20375c'
const colorContainerHighestPlus3 = '#213961'

const colorError = '#ff6e6e'
const colorSuccess = '#66bb6a'

/** Color used to indicate something positive (e.g. winning). */
const colorPositive = '#69f0ae'
const colorPositiveInvert = '#2f6805'
/** Color used to indicate something negative (e.g. losing). */
const colorNegative = '#e66060'
const colorNegativeInvert = '#ae061a'

export const colorZerg = '#c1a3f5'
export const colorProtoss = '#ead36d'
export const colorTerran = '#53b3fc'
export const colorRandom = '#f3ab60'

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

  --theme-purple: var(--color-purple60);
  --theme-on-purple: var(--color-purple99);
  --theme-purple-container: var(--color-purple40);
  --theme-on-purple-container: var(--color-purple95);

  --theme-grey-blue: var(--color-grey-blue60);
  --theme-on-grey-blue: var(--color-grey-blue99);
  --theme-grey-blue-container: var(--color-grey-blue40);
  --theme-on-grey-blue-container: var(--color-grey-blue95);

  --theme-surface: var(--color-blue10);
  --theme-on-surface: var(--color-grey99);
  --theme-on-surface-variant: var(--color-blue95);
  --theme-inverse-surface: var(--color-blue95);
  --theme-inverse-on-surface: var(--color-grey-blue10);
  --theme-inverse-primary: var(--color-blue50);

  --theme-outline: var(--color-grey-blue60);
  --theme-outline-variant: var(--color-grey-blue50);
  --theme-inverse-outline: var(--color-grey-blue50);
  --theme-inverse-outline-variant: var(--color-grey-blue90);

  --theme-container-lowest: ${colorContainerLowest};
  --theme-container-low: ${colorContainerLow};
  --theme-container: ${colorContainer};
  --theme-container-high: ${colorContainerHigh};
  --theme-container-highest: ${colorContainerHighest};
  /** These are "internal" and shouldn't be used directly. */
  --_theme-container-highest-plus1: ${colorContainerHighestPlus1};
  --_theme-container-highest-plus2: ${colorContainerHighestPlus2};
  --_theme-container-highest-plus3: ${colorContainerHighestPlus3};
  /** End internal */

  --theme-disabled-opacity: 0.38;

  --theme-error: ${colorError};
  --theme-success: ${colorSuccess};

  --theme-positive: ${colorPositive};
  --theme-positive-invert: ${colorPositiveInvert};
  --theme-negative: ${colorNegative};
  --theme-negative-invert: ${colorNegativeInvert};

  --theme-color-zerg: ${colorZerg};
  --theme-color-protoss: ${colorProtoss};
  --theme-color-terran: ${colorTerran};
  --theme-color-random: ${colorRandom};

  --theme-dialog-scrim: var(--color-grey-blue10);
  --theme-dialog-scrim-opacity: ${dialogScrimOpacity};

  --theme-skeleton: var(--color-grey-blue60);
`

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

// TODO(tec27): Use APCA instead of WCAG contrast stuff
/** Picks a text color for a given background color that will meet contrast guidelines. */
export function pickTextColor(backgroundColor: string): string {
  return meetsContrastGuidelines(backgroundColor, grey99).AA ? grey99 : grey10
}

export enum ContainerLevel {
  Lowest,
  Low,
  Normal,
  High,
  Highest,
}

export function containerStyles(level: ContainerLevel) {
  switch (level) {
    case ContainerLevel.Lowest:
      return css`
        background-color: var(--theme-container-lowest);
        --sb-color-background: var(--theme-container-lowest);

        --_tc0-lowest: var(--theme-container-low);
        --_tc0-low: var(--theme-container);
        --_tc0-normal: var(--theme-container-high);
        --_tc0-high: var(--theme-container-highest);
        --_tc0-highest: var(--_theme-container-highest-plus1);
        --_tc0-highest-plus1: var(--_theme-container-highest-plus2);
        --_tc0-highest-plus2: var(--_theme-container-highest-plus3);

        & > * {
          --theme-container-lowest: var(--_tc0-lowest);
          --theme-container-low: var(--_tc0-low);
          --theme-container: var(--_tc0-normal);
          --theme-container-high: var(--_tc0-high);
          --theme-container-highest: var(--_tc0-highest);
          --theme-container-highest-plus1: var(--_tc0-highest-plus1);
          --theme-container-highest-plus2: var(--_tc0-highest-plus2);
        }
      `
    case ContainerLevel.Low:
      return css`
        background-color: var(--theme-container-low);
        --sb-color-background: var(--theme-container-low);

        --_tc1-lowest: var(--theme-container);
        --_tc1-low: var(--theme-container-high);
        --_tc1-normal: var(--theme-container-highest);
        --_tc1-high: var(--_theme-container-highest-plus1);
        --_tc1-highest: var(--_theme-container-highest-plus2);
        --_tc1-highest-plus1: var(--_theme-container-highest-plus3);
        --_tc1-highest-plus2: var(--_theme-container-highest-plus3);

        & > * {
          --theme-container-lowest: var(--_tc1-lowest);
          --theme-container-low: var(--_tc1-low);
          --theme-container: var(--_tc1-normal);
          --theme-container-high: var(--_tc1-high);
          --theme-container-highest: var(--_tc1-highest);
          --theme-container-highest-plus1: var(--_tc1-highest-plus1);
          --theme-container-highest-plus2: var(--_tc1-highest-plus2);
        }
      `
    case ContainerLevel.Normal:
      return css`
        background-color: var(--theme-container);
        --sb-color-background: var(--theme-container);

        --_tc2-lowest: var(--theme-container-high);
        --_tc2-low: var(--theme-container-highest);
        --_tc2-normal: var(--_theme-container-highest-plus1);
        --_tc2-high: var(--_theme-container-highest-plus2);
        --_tc2-highest: var(--_theme-container-highest-plus3);
        --_tc2-highest-plus1: var(--_theme-container-highest-plus3);
        --_tc2-highest-plus2: var(--_theme-container-highest-plus3);

        & > * {
          --theme-container-lowest: var(--_tc2-lowest);
          --theme-container-low: var(--_tc2-low);
          --theme-container: var(--_tc2-normal);
          --theme-container-high: var(--_tc2-high);
          --theme-container-highest: var(--_tc2-highest);
          --theme-container-highest-plus1: var(--_tc2-highest-plus1);
          --theme-container-highest-plus2: var(--_tc2-highest-plus2);
        }
      `
    case ContainerLevel.High:
      return css`
        background-color: var(--theme-container-high);
        --sb-color-background: var(--theme-container-high);

        --_tc3-lowest: var(--theme-container-highest);
        --_tc3-low: var(--_theme-container-highest-plus1);
        --_tc3-normal: var(--_theme-container-highest-plus2);
        --_tc3-high: var(--_theme-container-highest-plus3);
        --_tc3-highest: var(--_theme-container-highest-plus3);
        --_tc3-highest-plus1: var(--_theme-container-highest-plus3);
        --_tc3-highest-plus2: var(--_theme-container-highest-plus3);

        & > * {
          --theme-container-lowest: var(--_tc3-lowest);
          --theme-container-low: var(--_tc3-low);
          --theme-container: var(--_tc3-normal);
          --theme-container-high: var(--_tc3-high);
          --theme-container-highest: var(--_tc3-highest);
          --theme-container-highest-plus1: var(--_tc3-highest-plus1);
          --theme-container-highest-plus2: var(--_tc3-highest-plus2);
        }
      `
    case ContainerLevel.Highest:
      return css`
        background-color: var(--theme-container-highest);
        --sb-color-background: var(--theme-container-highest);

        --_tc4-lowest: var(--_theme-container-highest-plus1);
        --_tc4-low: var(--_theme-container-highest-plus2);
        --_tc4-normal: var(--_theme-container-highest-plus3);
        --_tc4-high: var(--_theme-container-highest-plus3);
        --_tc4-highest: var(--_theme-container-highest-plus3);
        --_tc4-highest-plus1: var(--_theme-container-highest-plus3);
        --_tc4-highest-plus2: var(--_theme-container-highest-plus3);

        & > * {
          --theme-container-lowest: var(--_tc4-lowest);
          --theme-container-low: var(--_tc4-low);
          --theme-container: var(--_tc4-normal);
          --theme-container-high: var(--_tc4-high);
          --theme-container-highest: var(--_tc4-highest);
          --theme-container-highest-plus1: var(--_tc4-highest-plus1);
          --theme-container-highest-plus2: var(--_tc4-highest-plus2);
        }
      `
    default:
      return level satisfies never
  }
}
