import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { gameTypeToLabel } from '../../../common/games/game-type'
import { SbUserId } from '../../../common/users/sb-user-id'
import { AvatarStack } from '../../avatars/avatar-stack'
import { MapThumbnail } from '../../maps/map-thumbnail'
import { FilledButton } from '../../material/button'
import { buttonReset } from '../../material/button-reset'
import { bodyMedium, labelLarge, singleLine, titleMedium } from '../../styles/typography'
import { ConnectedUsername } from '../../users/connected-username'
import { LobbyChip } from './browser-parts'
import { LobbySummary } from './summary-utils'

const RowRoot = styled.button<{ $selected: boolean }>`
  ${buttonReset};

  width: 100%;
  min-height: 80px;
  padding: 8px 16px 8px 8px;

  display: flex;
  align-items: center;
  gap: 16px;

  border-radius: 8px;
  text-align: left;

  &:hover {
    background-color: var(--theme-container-low);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-primary);
    outline-offset: -2px;
  }

  ${props =>
    props.$selected
      ? css`
          background-color: rgb(from var(--theme-primary) r g b / 0.12);
          --sb-avatar-stack-ring: color-mix(
            in srgb,
            var(--theme-primary) 12%,
            var(--theme-surface)
          );

          &:hover {
            background-color: rgb(from var(--theme-primary) r g b / 0.16);
          }
        `
      : null};
`

const Thumbnail = styled.div`
  width: 64px;
  height: 64px;
  flex-shrink: 0;

  border-radius: 4px;
  overflow: hidden;
`

const Main = styled.div`
  flex-grow: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

const Name = styled.div`
  ${titleMedium};
  ${singleLine};
`

const MetaLine = styled.div`
  ${bodyMedium};
  ${singleLine};

  color: var(--theme-on-surface-variant);
`

const MetaSeparator = styled.span`
  padding: 0 6px;
  opacity: 0.7;
`

const Trailing = styled.div`
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 16px;
`

const Occupancy = styled.div`
  ${labelLarge};

  min-width: 44px;

  display: flex;
  align-items: baseline;
  justify-content: flex-end;

  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const OccupancyTaken = styled.span`
  color: var(--theme-on-surface);
`

/**
 * Reserves a column for the row's badge (or its absence), so badges line up with each other down
 * the list. Only a floor: a long enough readout takes the space it needs out of the lobby's name
 * rather than spilling into the occupancy beside it.
 */
const StatusSlot = styled.div`
  min-width: 124px;
  flex-shrink: 0;

  display: flex;
  justify-content: flex-end;
`

/** Whatever the row has to say about the lobby's state right now, if anything. */
function StatusBadge({ summary }: { summary: LobbySummary }) {
  const { t } = useTranslation()

  // Player seats, not overall joinability: a lobby whose player seats are gone reads as Full even
  // when an open observer seat keeps it in the default (joinable) view — the badge explains why
  // its count reads 8/8, and the rail explains what joining now means.
  if (summary.playerSlots.open === 0) {
    return <LobbyChip>{t('lobbies.browser.full', 'Full')}</LobbyChip>
  }

  return null
}

/**
 * The row's own compact join affordance, revealed on hover so it doesn't compete with the row's
 * badge/occupancy readout at rest. It sits over where the occupancy count renders, so that count
 * fades out alongside it coming in (see `RowWrapper` below) rather than the two overlapping.
 */
const JoinButton = styled(FilledButton)`
  position: absolute;
  right: 16px;
  top: 50%;

  min-width: 0;
  min-height: 32px;
  padding-inline: 14px;

  opacity: 0;
  pointer-events: none;
  transform: translateY(calc(-50% + 4px));

  transition:
    opacity 150ms ease,
    transform 150ms ease;
`

const revealedJoinButton = css`
  ${JoinButton} {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(-50%);
  }

  ${Occupancy} {
    opacity: 0;
  }
`

/**
 * `RowRoot` is a `<button>`, so its join affordance can't nest inside it (buttons can't contain
 * buttons). This wraps it instead, positioning the compact join button over the row's trailing
 * edge as a sibling, revealed on hover, while selected, or (for keyboard users tabbing to the
 * button, which stays focusable even while visually hidden) on focus-within. `$hasJoinButton`
 * gates all three: when there's no button to reveal (a full or the viewer's own lobby), the
 * occupancy count must stay put rather than fading out over nothing.
 */
const RowWrapper = styled.div<{ $selected: boolean; $hasJoinButton: boolean }>`
  position: relative;

  ${props => (props.$hasJoinButton && props.$selected ? revealedJoinButton : null)};

  ${props =>
    props.$hasJoinButton
      ? css`
          &:hover,
          &:focus-within {
            ${revealedJoinButton};
          }
        `
      : null};
`

export interface LobbyRowProps {
  summary: LobbySummary
  selected: boolean
  /** The viewer's friends who are inside this lobby, in seating order. */
  friendIds: ReadonlyArray<SbUserId>
  /** Whether this is the lobby the viewer is currently in. */
  isOwn: boolean
  onSelect: () => void
  /** Joins this lobby as a player, or — for the viewer's own lobby — returns to it. */
  onJoin: () => void
}

/**
 * One lobby in the browser's list: what it is and who's running it, with the facts you'd scan for
 * — friends inside, how full it is — lined up down the right. Hovering (or selecting) it surfaces a
 * quick join button, and double-clicking joins outright.
 */
export function LobbyRow({ summary, selected, friendIds, isOwn, onSelect, onJoin }: LobbyRowProps) {
  const { t } = useTranslation()
  const { taken, total, open } = summary.playerSlots
  const canJoin = !isOwn && open > 0

  return (
    <RowWrapper $selected={selected} $hasJoinButton={canJoin}>
      <RowRoot
        type='button'
        $selected={selected}
        aria-pressed={selected}
        onClick={onSelect}
        onDoubleClick={onJoin}
        data-testid='lobby-list-entry'>
        <Thumbnail>
          <MapThumbnail map={summary.map} size={256} forceAspectRatio={1} />
        </Thumbnail>
        <Main>
          <Name title={summary.name}>{summary.name}</Name>
          <MetaLine>
            <span>{summary.map.name}</span>
            <MetaSeparator>·</MetaSeparator>
            <span>{gameTypeToLabel(summary.gameType, t)}</span>
            <MetaSeparator>·</MetaSeparator>
            <ConnectedUsername userId={summary.host.id} interactive={false} />
          </MetaLine>
        </Main>

        <Trailing>
          <AvatarStack userIds={friendIds} size={20} max={3} />
          <StatusSlot>
            <StatusBadge summary={summary} />
          </StatusSlot>
          {/* Last in the row, so the count sits at the same offset no matter what precedes it. */}
          <Occupancy>
            <OccupancyTaken>{taken}</OccupancyTaken>/{total}
          </Occupancy>
        </Trailing>
      </RowRoot>

      {canJoin ? (
        <JoinButton
          label={t('lobbies.browser.join', 'Join')}
          onClick={() => {
            onSelect()
            onJoin()
          }}
          testName='lobby-row-join'
        />
      ) : null}
    </RowWrapper>
  )
}
