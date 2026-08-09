import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { gameTypeToLabel } from '../../../common/games/game-type'
import { SbUserId } from '../../../common/users/sb-user-id'
import { AvatarStack } from '../../avatars/avatar-stack'
import { MapThumbnail } from '../../maps/map-thumbnail'
import { buttonReset } from '../../material/button-reset'
import { bodyMedium, labelLarge, singleLine, titleMedium } from '../../styles/typography'
import { ConnectedUsername } from '../../users/connected-username'
import { HostCrown, LobbyChip } from './browser-parts'
import { LobbySummary } from './summary-utils'

const RowRoot = styled.button<{ $selected: boolean }>`
  ${buttonReset};

  width: 100%;
  min-height: 80px;
  padding: 8px 16px 8px 8px;

  /* The fixed-width columns below shed themselves at narrow widths (via container queries
     against this row) rather than crushing the flexible name/map column to nothing. */
  container-type: inline-size;

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
  align-items: flex-start;
  gap: 16px;
`

const PrimaryColumn = styled.div`
  flex-grow: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

/**
 * Uniform width, so the host's name starts at the same x-position in every row: scanning down the
 * list for a host means scanning a straight column, not re-finding it after however much map and
 * game-type text happened to precede it. The width comes from the row's size (identical for every
 * row) rather than flex-shrink (which would divide space by each row's own text lengths and bend
 * the column): as the row narrows, this column is the first to give, sliding from 160px down to a
 * floor that still fits a typical name, before the trailing slots start shedding.
 */
const HostColumn = styled.div`
  width: clamp(96px, calc(100cqw - 552px), 160px);
  flex-shrink: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;

  /* The last column standing before the name itself would become unreadable — below this the
     rail is the place to learn who's hosting. */
  @container (max-width: 408px) {
    display: none;
  }
`

const Name = styled.div`
  ${titleMedium};
  ${singleLine};
`

const MapName = styled.div`
  ${bodyMedium};
  ${singleLine};

  color: var(--theme-on-surface-variant);
`

const HostNameRow = styled.div`
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 4px;
`

const HostName = styled.div`
  ${bodyMedium};
  ${singleLine};
  min-width: 0;

  color: var(--theme-on-surface);
`

const GameTypeLabel = styled.div`
  ${bodyMedium};
  ${singleLine};

  color: var(--theme-on-surface-variant);
`

const Trailing = styled.div`
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 16px;
`

/**
 * A fixed-width column for the stack of the viewer's friends in the lobby (or its absence), so the
 * columns around it hold the same x-position in every row no matter how many faces the stack
 * shows. Sized for the stack at its widest: three faces, or two plus the overflow tail.
 */
const FriendsSlot = styled.div`
  width: 52px;
  flex-shrink: 0;

  display: flex;
  justify-content: flex-end;

  /* Below this the fixed column costs more than it's worth: faces still show, sized to what's
     actually there, and a slot with no faces stops taxing the name and host columns. */
  @container (max-width: 616px) {
    width: auto;

    &:empty {
      display: none;
    }
  }
`

const Occupancy = styled.div`
  ${labelLarge};

  /* Player slots cap at 8, so this only ever holds a three-character N/8. */
  min-width: 32px;

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
 * A fixed-width column for the row's badge (or its absence), so badges line up with each other
 * down the list and the columns before them start at the same x-position in every row. A chip too
 * long for it ellipsizes rather than widening this row's slot relative to its neighbors'.
 */
const StatusSlot = styled.div`
  width: 124px;
  flex-shrink: 0;

  display: flex;
  justify-content: flex-end;

  /* Below this the fixed column costs more than it's worth: a badge still shows, sized to its
     text, and a badgeless slot stops taxing the name and host columns. */
  @container (max-width: 616px) {
    width: auto;

    &:empty {
      display: none;
    }
  }
`

/** Whatever the row has to say about the lobby's state right now, if anything. */
function StatusBadge({ summary }: { summary: LobbySummary }) {
  const { t } = useTranslation()

  // Player seats, not overall joinability: the badge explains why a lobby's count reads 8/8.
  // When an open observer seat is what's keeping the lobby in the default (joinable) view, say
  // that instead — it covers both why the count is maxed and why the lobby is still listed.
  if (summary.playerSlots.open === 0) {
    return summary.observerSlots.open > 0 ? (
      <LobbyChip>{t('lobbies.browser.obsOpen', 'Obs open')}</LobbyChip>
    ) : (
      <LobbyChip>{t('lobbies.browser.full', 'Full')}</LobbyChip>
    )
  }

  return null
}

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
  /** Reaches the underlying row `<button>`, so the list can move focus alongside selection. */
  ref?: React.Ref<HTMLButtonElement>
}

/**
 * One lobby in the browser's list: what it is and who's running it, with the facts you'd scan for
 * — friends inside, how full it is — lined up down the right. Clicking (or arrowing to) a row
 * selects it for the rail's preview; double-clicking — or Enter — joins outright.
 */
export function LobbyRow({
  summary,
  selected,
  friendIds,
  isOwn,
  onSelect,
  onJoin,
  ref,
}: LobbyRowProps) {
  const { t } = useTranslation()
  const { taken, total, open } = summary.playerSlots
  const canJoin = !isOwn && open > 0

  // Roving tabindex: the list is one tab stop — Tab lands on the selected row, and the arrow keys
  // (handled at the page level) move the selection and focus together.
  return (
    <RowRoot
      ref={ref}
      type='button'
      $selected={selected}
      aria-pressed={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onDoubleClick={() => {
        // Gated the same way as Enter below: a full lobby's row shouldn't fire a join request
        // that's already known to fail.
        if (canJoin || isOwn) {
          onJoin()
        }
      }}
      onKeyDown={e => {
        // The keyboard twin of double-click. preventDefault stops the browser's synthetic
        // click, which would only re-select.
        if (e.key === 'Enter') {
          e.preventDefault()
          if (canJoin || isOwn) {
            onJoin()
          }
        }
      }}
      data-testid='lobby-list-entry'>
      <Thumbnail>
        <MapThumbnail map={summary.map} size={256} forceAspectRatio={1} />
      </Thumbnail>
      <Main>
        <PrimaryColumn>
          <Name title={summary.name}>{summary.name}</Name>
          <MapName>{summary.map.name}</MapName>
        </PrimaryColumn>
        <HostColumn>
          <HostNameRow>
            <HostCrown tabIndex={-1} />
            <HostName>
              <ConnectedUsername userId={summary.host.id} interactive={false} />
            </HostName>
          </HostNameRow>
          <GameTypeLabel>{gameTypeToLabel(summary.gameType, t)}</GameTypeLabel>
        </HostColumn>
      </Main>

      <Trailing>
        <FriendsSlot>
          <AvatarStack userIds={friendIds} size={20} max={3} showNamesTooltip />
        </FriendsSlot>
        <StatusSlot>
          <StatusBadge summary={summary} />
        </StatusSlot>
        {/* Last in the row, so the count sits at the same offset no matter what precedes it. */}
        <Occupancy>
          <OccupancyTaken>{taken}</OccupancyTaken>/{total}
        </Occupancy>
      </Trailing>
    </RowRoot>
  )
}
