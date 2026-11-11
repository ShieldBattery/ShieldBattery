import styled from 'styled-components'
import { bodySmall, singleLine, titleSmall } from '../../styles/typography'

/** A list of rows naming files or folders on this PC, each with an icon, a title and its path. */
export const PathList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

export const PathRow = styled.div`
  min-height: 56px;
  padding: 8px 8px 8px 12px;

  display: flex;
  align-items: center;
  gap: 12px;

  border-radius: 8px;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }
`

export const PathIconTile = styled.div`
  flex-shrink: 0;
  width: 40px;
  height: 40px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 8px;
  background-color: var(--theme-container-high);
  color: var(--theme-on-surface-variant);
`

export const PathText = styled.div`
  flex: 1 1 auto;
  min-width: 0;

  display: flex;
  flex-direction: column;
`

export const PathName = styled.div`
  ${titleSmall};
  ${singleLine};
`

export const PathDetail = styled.div`
  ${bodySmall};
  ${singleLine};

  color: var(--theme-on-surface-variant);
`
