import { TFunction } from 'i18next'
import * as React from 'react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getHumanSlots, Lobby } from '../../../common/lobbies'
import { RaceChar, raceCharToLabel } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user-id'
import { MaterialIcon } from '../../icons/material/material-icon'
import { buttonReset } from '../../material/button-reset'
import {
  OriginX,
  OriginY,
  PopoverOpenState,
  usePopoverController,
  useRefAnchorPosition,
} from '../../material/popover'
import { Tooltip } from '../../material/tooltip'
import { useAppSelector } from '../../redux-hooks'
import { getRaceColor } from '../../styles/colors'
import { labelSmall, singleLine } from '../../styles/typography'
import { RaceIcon } from '../race-icon'

/** The order races are laid out in, left to right, wherever all four are shown side by side. */
const RACE_ORDER: ReadonlyArray<RaceChar> = ['z', 'p', 't', 'r']

const RaceMarkIcon = styled(RaceIcon)`
  width: 24px;
  height: 24px;
  flex-shrink: 0;

  fill: currentColor;
`

/** A player's race, at the size the room's rows and cards read it at. */
export function RaceMark({ race, className }: { race: RaceChar; className?: string }) {
  const { t } = useTranslation()
  return <RaceMarkIcon race={race} ariaLabel={raceCharToLabel(race, t)} className={className} />
}

const RaceOption = styled.button<{ $race: RaceChar; $active: boolean }>`
  ${buttonReset};
  width: 28px;
  height: 28px;
  padding: 2px;
  flex-shrink: 0;

  display: flex;

  border-radius: 4px;

  --sb-race-color: ${props => getRaceColor(props.$race)};
  color: ${props => (props.$active ? 'var(--sb-race-color)' : 'var(--theme-on-surface-variant)')};
  opacity: ${props => (props.$active ? 1 : 0.72)};

  /*
   * The picked race is underlined as well as colored, so which one is picked still reads where
   * color doesn't carry it (color blindness, a forced-colors theme, a screenshot in greyscale).
   */
  &::after {
    content: '';
    position: absolute;
    inset-inline: 4px;
    bottom: 0;

    height: 2px;
    border-radius: 1px;

    background-color: currentColor;
    opacity: ${props => (props.$active ? 1 : 0)};
  }

  &:hover {
    color: var(--sb-race-color);
    opacity: 1;
  }
`

const RaceOptionIcon = styled(RaceIcon)`
  width: 100%;
  height: 100%;

  fill: currentColor;
`

const RacePickerRoot = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
`

/** The four races, laid out inline so a player can change theirs without leaving their row. */
export function InlineRacePicker({
  race,
  onSetRace,
  className,
}: {
  race: RaceChar
  onSetRace: (race: RaceChar) => void
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <RacePickerRoot
      className={className}
      role='radiogroup'
      aria-label={t('lobbies.room.racePicker.label', 'Race')}>
      {RACE_ORDER.map(r => (
        <RaceOption
          key={r}
          type='button'
          role='radio'
          aria-checked={r === race}
          aria-label={raceCharToLabel(r, t)}
          $race={r}
          $active={r === race}
          title={raceCharToLabel(r, t)}
          onClick={() => onSetRace(r)}>
          <RaceOptionIcon race={r} applyRaceColor={false} />
        </RaceOption>
      ))}
    </RacePickerRoot>
  )
}

const ReadyMarkRoot = styled.span<{ $ready: boolean }>`
  flex-shrink: 0;
  display: flex;

  color: ${props => (props.$ready ? 'var(--theme-positive)' : 'var(--theme-on-surface-variant)')};
  opacity: ${props => (props.$ready ? 1 : 0.6)};
`

/**
 * Whether a seated member has readied up for the next game.
 *
 * NOTE: Rendered as a filled check or an outlined ring rather than a colored dot, so it can't be
 * mistaken for a presence indicator.
 */
export function ReadyMark({ ready, tabIndex }: { ready: boolean; tabIndex?: number }) {
  const { t } = useTranslation()
  return (
    <Tooltip
      text={
        ready
          ? t('lobbies.room.readyMark.ready', 'Ready')
          : t('lobbies.room.readyMark.notReady', 'Not ready yet')
      }
      tabIndex={tabIndex}>
      <ReadyMarkRoot $ready={ready}>
        <MaterialIcon icon={ready ? 'check_circle' : 'circle'} size={18} filled={ready} />
      </ReadyMarkRoot>
    </Tooltip>
  )
}

/** How the host can rearrange the seats before running the next game. */
export enum TeamArrangement {
  Swap = 'swap',
  Shuffle = 'shuffle',
}

/** A compact pill describing one piece of the lobby's setup. */
export const RoomChip = styled.div`
  ${labelSmall};
  ${singleLine};
  padding: 4px 10px;

  border: 1px solid transparent;
  border-radius: 999px;
  background-color: var(--theme-container-high);
  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`

/** The heading above one group of rows in the roster rail, e.g. `TEAM 1 · TOP`. */
export const SectionLabel = styled.div`
  ${labelSmall};
  ${singleLine};
  padding: 0 4px;

  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`

const HostCrownRoot = styled.span`
  color: var(--theme-amber);
  flex-shrink: 0;
  display: flex;
`

/** Marks the row of the lobby's host. */
export function HostCrown({ tabIndex }: { tabIndex?: number }) {
  const { t } = useTranslation()
  return (
    <Tooltip text={t('lobbies.summary.hostLabel', 'Host')} tabIndex={tabIndex}>
      <HostCrownRoot>
        <MaterialIcon icon='crown' size={20} filled />
      </HostCrownRoot>
    </Tooltip>
  )
}

/**
 * Returns everyone the lobby waits on during a ready check: the people seated in it, players and
 * observers alike. Members on the bench have no part in the next game, so they aren't counted.
 */
export function getReadyEligibleUsers(lobby: Lobby): SbUserId[] {
  return getHumanSlots(lobby)
    .map(slot => slot.userId)
    .filter((userId): userId is SbUserId => userId !== undefined)
}

/** Counts everyone who is in the lobby, seated or waiting for a seat. */
export function memberCount(lobby: Lobby): number {
  return getReadyEligibleUsers(lobby).length + lobby.bench.length
}

/**
 * Names one of a lobby's teams the way the room labels it everywhere it comes up: the rail's
 * headings, a member's seat in their arrival card, and the side that won a finished game.
 *
 * Team ids are the lobby's own (a team game's sides are numbered from 1; a map's forces carry the
 * map's ids), so a series game's teams, captured when it launched, label the same way the live
 * layout does.
 */
export function lobbyTeamLabel(team: { teamId: number; name?: string }, t: TFunction): string {
  return team.name
    ? t('lobbies.room.teamLabelNamed', {
        defaultValue: 'Team {{number}} · {{name}}',
        number: team.teamId,
        name: team.name,
      })
    : t('game.teamName.number', {
        defaultValue: 'Team {{teamNumber}}',
        teamNumber: team.teamId,
      })
}

/**
 * Where a lobby stands relative to its next game.
 *
 * Only a gathering lobby's layout can be changed: the countdown snapshots the game's configuration
 * (seats and races included), and the server refuses changes to it from then until the game ends
 * and the lobby regroups. The one exception is the bench, which takes no part in the game and
 * stays the host's to manage while it runs.
 */
export type LobbyLifecycle = 'gathering' | 'countingDown' | 'loading' | 'inGame'

/** Reads the current lobby's {@link LobbyLifecycle} from the store. */
export function useLobbyLifecycle(): LobbyLifecycle {
  return useAppSelector(s => {
    if (s.lobby.runState) {
      return 'inGame'
    }
    if (s.lobby.loadingState.isLoading) {
      return 'loading'
    }
    if (s.lobby.loadingState.isCountingDown) {
      return 'countingDown'
    }
    return 'gathering'
  })
}

/**
 * Wires a popover menu to the button that opens it: the anchor position the popover is placed at,
 * and open/close state whose close puts keyboard focus back on that button. A dismissed popover
 * otherwise leaves focus on the document body, stranding whoever opened it from the keyboard.
 */
export function useAnchoredMenu<T extends HTMLElement>(
  originX: OriginX,
  originY: OriginY,
): {
  anchorRef: (elem: T | null) => void
  anchorX: number | undefined
  anchorY: number | undefined
  isOpen: PopoverOpenState
  openMenu: (triggeringEvent: Event | React.SyntheticEvent) => boolean
  closeMenu: () => void
} {
  const anchorElem = useRef<T | null>(null)
  const [positionRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition<T>(
    originX,
    originY,
  )
  const [isOpen, openMenu, closePopover] = usePopoverController({ refreshAnchorPos })

  const anchorRef = (elem: T | null) => {
    anchorElem.current = elem
    positionRef(elem)
  }
  const closeMenu = () => {
    closePopover()
    anchorElem.current?.focus()
  }

  return { anchorRef, anchorX, anchorY, isOpen, openMenu, closeMenu }
}
