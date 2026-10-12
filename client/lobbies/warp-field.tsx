import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { Tooltip } from '../material/tooltip'
import { labelMedium } from '../styles/typography'

/**
 * What Warp Field does to a lobby's games. Warp Field is the player-facing name for a lobby with
 * `starcraftCompatibleReplays` turned off.
 */
export function warpFieldDescription(t: TFunction): string {
  return t(
    'lobbies.warpField.description',
    "Apply ShieldBattery's small, carefully tested set of fixes for gameplay issues. Replays of " +
      'these games may not play back correctly outside of ShieldBattery.',
  )
}

/**
 * The fixes Warp Field turns on, as a player would notice them. These are exactly the game logic
 * fixes with a `LogicFix::disable_bit` in `game/src/replay.rs`, so this list has to change whenever
 * that set does.
 */
function warpFieldFixes(t: TFunction): string[] {
  return [
    t(
      'lobbies.warpField.fixStalledWalk',
      'Units no longer get stuck in place after an attack, ignoring orders to move until told to ' +
        'stop.',
    ),
  ]
}

const InfoIcon = styled.span`
  flex-shrink: 0;
  display: flex;
  color: var(--theme-on-surface-variant);
`

/**
 * An info icon whose tooltip says what Warp Field does, for wherever a lobby shows it's turned on.
 */
export function WarpFieldDescriptionInfo({ size = 14 }: { size?: number }) {
  const { t } = useTranslation()
  return (
    <Tooltip text={warpFieldDescription(t)}>
      <InfoIcon>
        <MaterialIcon icon='info' size={size} />
      </InfoIcon>
    </Tooltip>
  )
}

const FixListContent = styled.div`
  ${labelMedium};
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
`

const FixList = styled.ul`
  margin: 0;
  padding-left: 16px;
`

/** An info icon whose tooltip lists the fixes Warp Field currently includes. */
export function WarpFieldFixesInfo() {
  const { t } = useTranslation()
  return (
    <Tooltip
      text={
        <FixListContent>
          <span>{t('lobbies.warpField.fixesHeading', 'Warp Field currently includes:')}</span>
          <FixList>
            {warpFieldFixes(t).map(fix => (
              <li key={fix}>{fix}</li>
            ))}
          </FixList>
        </FixListContent>
      }
      position='right'>
      <InfoIcon>
        <MaterialIcon icon='info' size={18} />
      </InfoIcon>
    </Tooltip>
  )
}
