import styled, { css } from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from './button-reset'
import { shadowDef1dp } from './shadows'

/** The side length (in pixels) of a standard color swatch button. */
export const SWATCH_SIZE = 36

const swatchShape = css`
  width: ${SWATCH_SIZE}px;
  height: ${SWATCH_SIZE}px;
  border-radius: 6px;
`

export const SwatchButton = styled.button<{ $color: string }>`
  ${buttonReset};
  ${swatchShape};
  position: relative;
  flex-shrink: 0;

  background-color: ${props => props.$color};
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.18);
  cursor: pointer;

  &:disabled {
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid var(--theme-amber);
    outline-offset: 2px;
  }
`

export const AddSwatchTile = styled.button`
  ${buttonReset};
  ${swatchShape};
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  border: 1px dashed var(--theme-outline);
  color: var(--theme-on-surface-variant);
  cursor: pointer;

  transition:
    border-color 100ms linear,
    color 100ms linear;

  &:hover,
  &:focus-visible {
    border-color: var(--color-blue80);
    color: var(--color-blue80);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-amber);
    outline-offset: 2px;
  }

  &:disabled {
    cursor: default;
    border-color: rgb(from var(--theme-on-surface) r g b / var(--theme-disabled-opacity));
    color: rgb(from var(--theme-on-surface) r g b / var(--theme-disabled-opacity));
  }
`

export function AddSwatchIcon() {
  return <MaterialIcon icon='add' size={18} />
}

export const RemoveSwatchBadge = styled.button`
  ${buttonReset};
  position: absolute;
  top: -6px;
  right: -6px;
  width: 16px;
  height: 16px;

  display: flex;
  align-items: center;
  justify-content: center;

  background-color: var(--color-grey-blue40);
  border-radius: 50%;
  box-shadow: ${shadowDef1dp};
  color: var(--color-grey99);
  cursor: pointer;

  transition: background-color 100ms linear;

  &:hover,
  &:focus-visible {
    background-color: var(--theme-negative);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-amber);
    outline-offset: 1px;
  }
`

export function RemoveSwatchIcon() {
  return <MaterialIcon icon='close' size={11} />
}
