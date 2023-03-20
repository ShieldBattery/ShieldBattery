import React from 'react'
import styled from 'styled-components'

const IconRoot = styled.span<{ $size: number; $filled: boolean; $invertColor: boolean }>`
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: ${props => props.$size}px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;

  width: ${props => props.$size}px;
  height: ${props => props.$size}px;

  font-variation-settings: 'FILL' ${props => (props.$filled ? 1 : 0)},
    'opsz' ${props => Math.min(48, Math.max(20, props.$size))},
    'GRAD' ${props => (props.$invertColor ? 0 : -25)};
`

export interface MaterialIconProps {
  /**
   * The icon name or unicode value. These can be found on https://fonts.google.com/icons.
   */
  icon: string
  /**
   * The size of the icon (in pixels). Defaults to `24`.
   */
  size?: number
  /**
   * Whether the icon should be filled or outlined. Defaults to `true` (filled).
   */
  filled?: boolean
  /** Whether the colors are inverted (dark icon on light background). Defaults to `false`. */
  invertColor?: boolean
}

export function MaterialIcon({
  icon,
  size = 24,
  filled = true,
  invertColor = false,
}: MaterialIconProps) {
  return (
    <IconRoot aria-hidden={true} $size={size} $filled={filled} $invertColor={invertColor}>
      {icon}
    </IconRoot>
  )
}
