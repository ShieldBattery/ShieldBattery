import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { Tooltip } from '../material/tooltip'
import { labelMedium } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
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
 * `--sb-avatar-stack-ring` to their own color — always an opaque one, since the ring overlaps the
 * face beneath it.
 */
const stackRing = '0 0 0 2px var(--sb-avatar-stack-ring, var(--theme-surface))'

const StackItem = styled.div<{ $size: number; $overlap: number }>`
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;
  flex-shrink: 0;

  display: flex;

  /* Each face must be its own stacking context: the default avatar's icon is a positioned
     element, so without this every face's icon paints above every sibling's background and ring —
     the face beneath shows through the silhouette cutout, and the rings never cross a neighboring
     disc. */
  isolation: isolate;

  border-radius: 50%;
  /* The same elevated neutral as the +N tail, so the default avatar's transparent silhouette
     reads as a solid two-tone badge rather than a hole — whatever the stack sits on. */
  background-color: var(--theme-container-high);
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

  /* Its own stacking context, like the faces: without it the last face's positioned icon paints
     over the tail's pill. */
  isolation: isolate;

  border-radius: 999px;
  box-shadow: ${stackRing};
  background-color: var(--theme-container-high);
  color: var(--theme-on-surface-variant);
`

const NameList = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;

  text-align: left;
`

export interface AvatarStackProps {
  userIds: ReadonlyArray<SbUserId>
  /** Diameter of each avatar, in pixels. Defaults to 24. */
  size?: number
  /** How many faces to show before the rest collapse into a `+N` tail. Defaults to 4. */
  max?: number
  /**
   * When set, hovering the stack names everyone in the group — including anyone the `+N` tail
   * folds away.
   */
  showNamesTooltip?: boolean
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
  showNamesTooltip,
  className,
}: AvatarStackProps) {
  if (!userIds.length) {
    return null
  }

  const overlap = Math.round(size / 3)
  // The tail takes a slot of its own, so an overflowing stack shows one fewer face than `max`.
  const shown = userIds.length > max ? userIds.slice(0, max - 1) : userIds
  const overflow = userIds.length - shown.length

  const stack = (
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

  if (!showNamesTooltip) {
    return stack
  }

  return (
    <Tooltip
      text={
        <NameList>
          {userIds.map(userId => (
            <ConnectedUsername key={userId} userId={userId} interactive={false} />
          ))}
        </NameList>
      }
      tabIndex={-1}>
      {stack}
    </Tooltip>
  )
}
