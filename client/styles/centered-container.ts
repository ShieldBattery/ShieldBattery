import * as m from 'motion/react-m'
import styled from 'styled-components'

/**
 * A container with normal horizontal padding intended for use as the "root" of application content
 * (below app bar). Content inside of it will be horizontally centered and the left edge will fall
 * on a whole pixel.
 *
 * The target width can be changed by setting the `$targetWidth` prop (defaults to `1184px`). Target
 * padding can be changed by settings the $targetHorizontalPadding prop (defaults to `24px`).
 *
 * Setting `$fullWidth` drops the target-width cap entirely, so the content spans the full available
 * width with only `$targetHorizontalPadding` on each edge. This suits pages that fill the space with
 * their own internal layout (e.g. multi-column pages with fixed side panels) rather than a single
 * centered column of text, where a max width would just leave dead space at the edges.
 *
 * A full-width page usually also wants to render the `data-content-fullbleed` marker (any element
 * inside `MainLayout`) so the shell gives up the left gutter it otherwise reserves to keep content
 * centered against the social sidebar — otherwise the page stays capped by that centered column no
 * matter how wide this container is allowed to be.
 */
export const CenteredContentContainer = styled(m.div)<{
  $targetWidth?: number
  $targetHorizontalPadding?: number
  $fullWidth?: boolean
}>`
  --_target-width: ${props => props.$targetWidth ?? 1184}px;
  --_target-horizontal-padding: ${props => props.$targetHorizontalPadding ?? 24}px;

  /** Dumb CSS properties just to avoid needing to write out this calculation multiple times. */
  --_half-content-width: ${props =>
    props.$fullWidth
      ? 'calc(50% - var(--_target-horizontal-padding))'
      : `min(
    50% - var(--_target-horizontal-padding),
    var(--_target-width) / 2 + var(--scrollbar-width)
  )`};

  width: 100%;
  height: 100%;
  /*
    Since we expect to have padding > the scrollbar width, this keeps things actually centered
    relative to the top menu bar, even if a scrollbar is present.
  */
  scrollbar-gutter: stable both-edges;
  /**
    Simulate margin: auto with only padding so that the scrollbar falls on the right edge of the
    parent container.
  */
  padding-inline: round(up, calc(50% - var(--_half-content-width)), 1px)
    round(down, calc(50% - var(--_half-content-width)), 1px);

  overflow-x: hidden;
  overflow-y: auto;

  /**
    Since we adjusted for pixel-shove-x, our descendants shouldn't need one. (Since we don't use
    the value directly, we can simply set it on this element rather than on our children)
  */
  --pixel-shove-x: 0;
`
