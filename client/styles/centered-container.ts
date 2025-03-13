import styled from 'styled-components'

/**
 * A container with normal horizontal padding intended for use as the "root" of application content
 * (below app bar). Content inside of it will be horizontally centered and the left edge will fall
 * on a whole pixel.
 *
 * The target width can be changed by setting the `$targetWidth` prop (defaults to `1200px`). Target
 * padding can be changed by settings the $targetHorizontalPadding prop (defaults to `24px`).
 */
export const CenteredContentContainer = styled.div<{
  $targetWidth?: number
  $targetHorizontalPadding?: number
}>`
  --_target-width: ${props => props.$targetWidth ?? 1200}px;
  --_target-horizontal-padding: ${props => props.$targetHorizontalPadding ?? 24}px;

  /** Dumb CSS properties just to avoid needing to write out this calculation multiple times. */
  --_half-content-width: min(50% - var(--_target-horizontal-padding), var(--_target-width) / 2);

  width: 100%;
  height: 100%;
  /**
    Simulate margin: auto with only padding so that the scrollbar falls on the right edge of the
    parent container.
  */
  padding: 0 round(down, calc(50% - var(--_half-content-width)), 1px) 0
    round(up, calc(50% - var(--_half-content-width)), 1px);

  overflow-x: hidden;
  overflow-y: auto;

  /**
    Since we adjusted for pixel-shove-x, our descendants shouldn't need one. (Since we don't use
    the value directly, we can simply set it on this element rather than on our children)
  */
  --pixel-shove-x: 0;
`
