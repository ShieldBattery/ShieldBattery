import styled from 'styled-components'
import { ReconciledResult } from '../../common/games/results'
import { labelSmall } from '../styles/typography'

/**
 * A compact win/loss/draw marker: the result's one-letter label over a tint of its own colour.
 * Used beside a player in the games list and on the user card's record line.
 */
export const PlayerResultChip = styled.span<{ $result: ReconciledResult }>`
  ${labelSmall};
  /*
    Sized by its label rather than fixed, since some locales abbreviate results to several
    characters (e.g. Russian) instead of one letter.
  */
  min-width: 16px;
  padding: 0 3px;
  height: 16px;
  margin-right: 6px;
  flex-shrink: 0;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 4px;
  font-weight: 700;
  color: ${props => {
    switch (props.$result) {
      case 'win':
        return 'var(--theme-positive)'
      case 'loss':
        return 'var(--theme-negative)'
      default:
        return 'var(--theme-on-surface-variant)'
    }
  }};
  background: color-mix(in srgb, currentColor 16%, transparent);
`
