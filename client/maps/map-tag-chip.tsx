import styled from 'styled-components'
import { Link } from 'wouter'
import { RoomChip } from '../lobbies/room/room-parts'

/** A map tag as a chip. */
export const TagChip = styled(RoomChip)`
  color: var(--theme-on-surface);
`

/** A link around a {@link TagChip}, usually to the maps with that tag. */
export const TagLink = styled(Link)`
  display: flex;
  border-radius: 999px;
  color: inherit;
  text-decoration: none;

  &:hover {
    text-decoration: none;
  }

  &:hover > ${TagChip} {
    background-color: var(--theme-container-highest);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-primary);
    outline-offset: 2px;
  }
`
