import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { RaceChar } from '../../../common/races'
import { MaterialIcon } from '../../icons/material/material-icon'
import { Tooltip } from '../../material/tooltip'
import { labelSmall, singleLine } from '../../styles/typography'
import { RaceIcon } from '../race-icon'

function raceName(race: RaceChar, t: TFunction): string {
  switch (race) {
    case 'z':
      return t('game.race.zerg', 'Zerg')
    case 'p':
      return t('game.race.protoss', 'Protoss')
    case 't':
      return t('game.race.terran', 'Terran')
    case 'r':
      return t('game.race.random', 'Random')
    default:
      return race satisfies never
  }
}

const RaceMarkIcon = styled(RaceIcon)`
  width: 24px;
  height: 24px;
  flex-shrink: 0;

  fill: currentColor;
`

/** A player's race, at the size the browser's rows and rail read it at. */
export function RaceMark({ race, className }: { race: RaceChar; className?: string }) {
  const { t } = useTranslation()
  return <RaceMarkIcon race={race} ariaLabel={raceName(race, t)} className={className} />
}

/** A compact pill describing one piece of the lobby's setup. */
export const LobbyChip = styled.div`
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

/** The heading above one group of rows in the detail rail, e.g. `TEAM 1 · TOP`. */
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
  return (
    <Tooltip text='Host' tabIndex={tabIndex}>
      <HostCrownRoot>
        <MaterialIcon icon='crown' size={20} filled />
      </HostCrownRoot>
    </Tooltip>
  )
}
