import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { labelMedium } from '../styles/typography'
import { ConnectedAvatar } from './avatar'

const DEFAULT_SIZE_PX = 24
const DEFAULT_MAX = 4

const StackRoot = styled.div`
  display: flex;
  align-items: center;
  flex-shrink: 0;
`

/**
 * Each face carries a ring in the color of whatever it sits on, which is what keeps overlapping
 * circles reading as separate people. Surfaces that aren't the page background set
 * `--sb-avatar-stack-ring` to their own color.
 */
const stackRing = '0 0 0 2px var(--sb-avatar-stack-ring, var(--theme-surface))'

const StackItem = styled.div<{ $size: number; $overlap: number }>`
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;
  flex-shrink: 0;

  display: flex;

  border-radius: 50%;
  box-shadow: ${stackRing};

  & + & {
    margin-left: -${props => props.$overlap}px;
  }
`

const StackAvatar = styled(ConnectedAvatar)`
  width: 100%;
  height: 100%;
`

const OverflowTail = styled.div<{ $size: number; $overlap: number }>`
  ${labelMedium};

  min-width: ${props => props.$size}px;
  height: ${props => props.$size}px;
  padding: 0 6px;
  margin-left: -${props => props.$overlap}px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 999px;
  box-shadow: ${stackRing};
  background-color: var(--theme-container-high);
  color: var(--theme-on-surface-variant);
`

export interface AvatarStackProps {
  userIds: ReadonlyArray<SbUserId>
  /** Diameter of each avatar, in pixels. Defaults to 24. */
  size?: number
  /** How many faces to show before the rest collapse into a `+N` tail. Defaults to 4. */
  max?: number
  className?: string
}

/**
 * A row of overlapping avatars for a group of people, ending in a `+N` tail once the group outgrows
 * `max`. Renders nothing for an empty group, so callers can hand it a list without guarding first.
 */
export function AvatarStack({
  userIds,
  size = DEFAULT_SIZE_PX,
  max = DEFAULT_MAX,
  className,
}: AvatarStackProps) {
  if (!userIds.length) {
    return null
  }

  const overlap = Math.round(size / 3)
  // The tail takes a slot of its own, so an overflowing stack shows one fewer face than `max`.
  const shown = userIds.length > max ? userIds.slice(0, max - 1) : userIds
  const overflow = userIds.length - shown.length

  return (
    <StackRoot className={className}>
      {shown.map(userId => (
        <StackItem key={userId} $size={size} $overlap={overlap}>
          {/* The live ring would collide with the stack's own ring at these sizes. */}
          <StackAvatar userId={userId} showLiveIndicator={false} />
        </StackItem>
      ))}
      {overflow > 0 ? (
        <OverflowTail $size={size} $overlap={overlap}>
          +{overflow}
        </OverflowTail>
      ) : null}
    </StackRoot>
  )
}
