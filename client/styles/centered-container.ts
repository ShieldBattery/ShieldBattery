import styled from 'styled-components'

/**
 * A container with normal horizontal padding intended for use as the "root" of application content
 * (between the left nav and action buttons). Content inside of it can be centered using
 * `margin: 0 auto` and will properly use pixel shoving to fall on whole pixels.
 */
export const CenteredContentContainer = styled.div`
  height: 100%;
  padding: 0 16px;
  border-left: var(--pixel-shove-x, 0) solid transparent;

  overflow-x: hidden;
  overflow-y: auto;
`
