import styled from 'styled-components'

/**
 * A container with normal horizontal padding intended for use as the "root" of application content
 * (below app bar). Content inside of it will be horizontally centered and the left edge will fall
 * on a whole pixel.
 *
 * The target width can be changed by setting the `$targetWidth` prop (defaults to `1200px`).
 */
export const CenteredContentContainer = styled.div<{ $targetWidth?: number }>`
  --target-width: ${props => props.$targetWidth ?? 1200}px;
  --target-horizontal-padding: 24px;

  /** Dumb CSS properties just to avoid needing to write out this calculation multiple times. */
  --internal-half-content-width: min(
    50% - var(--target-horizontal-padding),
    var(--target-width) / 2
  );

  width: 100%;
  height: 100%;
  /**
    Simulate margin: auto with only padding so that the scrollbar falls on the right edge of the
    parent container.
  */
  padding: 0 round(down, calc(50% - var(--internal-half-content-width)), 1px) 0
    round(up, calc(50% - var(--internal-half-content-width)), 1px);

  overflow-x: hidden;
  overflow-y: auto;
`
