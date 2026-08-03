import styled, { css } from 'styled-components'
import { RaceChar } from '../../../../common/races'
import { MaterialIcon } from '../../../icons/material/material-icon'
import { getRaceColor } from '../../../styles/colors'
import { labelMedium, labelSmall, titleTiny } from '../../../styles/typography'

const RACE_LETTERS: Record<RaceChar, string> = { z: 'Z', p: 'P', t: 'T', r: 'R' }

const RaceBadgeRoot = styled.div<{ $race: RaceChar; $selected: boolean; $small: boolean }>`
  ${titleTiny};

  width: ${props => (props.$small ? 20 : 24)}px;
  height: ${props => (props.$small ? 20 : 24)}px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  background-color: ${props => getRaceColor(props.$race)};
  border-radius: 50%;
  color: var(--color-blue10);

  ${props =>
    props.$selected
      ? css`
          box-shadow:
            0 0 0 2px var(--theme-container-lowest),
            0 0 0 4px ${getRaceColor(props.$race)};
        `
      : css``}
`

const DimmedRaceBadge = styled(RaceBadgeRoot)`
  background-color: rgb(from ${props => getRaceColor(props.$race)} r g b / 0.32);
  color: rgb(from var(--theme-on-surface) r g b / 0.7);
`

/** A player's race, as the race-colored disc the lobby's slot rows use to identify it. */
export function RaceBadge({
  race,
  selected = false,
  dimmed = false,
  small = false,
  className,
  onClick,
  title,
}: {
  race: RaceChar
  selected?: boolean
  dimmed?: boolean
  /** Sized down for the row-inline race picker, where four of these sit side by side. */
  small?: boolean
  className?: string
  onClick?: () => void
  title?: string
}) {
  const Root = dimmed ? DimmedRaceBadge : RaceBadgeRoot
  return (
    <Root
      className={className}
      $race={race}
      $selected={selected}
      $small={small}
      onClick={onClick}
      title={title ?? RACE_LETTERS[race]}>
      {RACE_LETTERS[race]}
    </Root>
  )
}

const ReadyCheck = styled(MaterialIcon)`
  flex-shrink: 0;
  color: var(--theme-positive);
`

const NotReadyRing = styled.div`
  width: 18px;
  height: 18px;
  flex-shrink: 0;

  border: 2px solid rgb(from var(--theme-on-surface) r g b / 0.24);
  border-radius: 50%;
`

/** Whether one member has readied up: a filled check, or the ring that's still waiting for them. */
export function ReadyMark({ ready }: { ready: boolean }) {
  return ready ? <ReadyCheck icon='check_circle' size={20} filled={false} /> : <NotReadyRing />
}

/** A rail section heading, e.g. `TEAM 1 · TOP` or `WATCHING · 1/4`. */
export const SectionLabel = styled.div<{ $amber?: boolean }>`
  ${labelSmall};

  padding: 16px 4px 6px;

  display: flex;
  align-items: baseline;
  gap: 8px;

  color: ${props => (props.$amber ? 'var(--theme-amber)' : 'var(--theme-on-surface-variant)')};
  letter-spacing: 0.08em;
  text-transform: uppercase;
`

/** The muted aside some section headings carry, explaining what the section is for. */
export const SectionNote = styled.span`
  ${labelSmall};

  color: rgb(from var(--theme-on-surface) r g b / 0.4);
  letter-spacing: 0;
  text-transform: none;
`

/** The amber badge marking the lobby's host. */
export const HostBadge = styled.div`
  ${labelSmall};

  height: 18px;
  flex-shrink: 0;
  padding-inline: 6px;

  display: flex;
  align-items: center;

  background-color: var(--theme-amber);
  border-radius: 4px;
  color: var(--color-blue10);
  letter-spacing: 0.06em;
`

/** A settings value the header reports, e.g. `TR 12`. */
export const SettingChip = styled.div<{ $updated?: boolean }>`
  ${labelMedium};

  height: 26px;
  flex-shrink: 0;
  padding-inline: 10px;

  display: flex;
  align-items: center;

  border: 1px solid transparent;
  border-radius: 6px;
  letter-spacing: 0.06em;
  white-space: nowrap;

  ${props =>
    props.$updated
      ? css`
          background-color: rgb(from var(--theme-amber) r g b / 0.14);
          border-color: rgb(from var(--theme-amber) r g b / 0.6);
          color: var(--theme-amber);
        `
      : css`
          background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
          color: var(--theme-on-surface-variant);
        `}
`
