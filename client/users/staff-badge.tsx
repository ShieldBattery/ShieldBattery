import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import Logo from '../logos/logo-no-bg.svg'
import { Tooltip } from '../material/tooltip'

const BadgeRoot = styled(Tooltip)`
  width: 22px;
  height: 22px;
  display: flex;
`

const BadgeDisc = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;

  /*
    The logo's own colors (dark indigo + amber) need a light background to read at this size, and
    the ring separates the disc from whatever the avatar shows behind it. The ring color matches
    the low-container surface the avatar cards sit on; override it when placing the badge on a
    different surface.
  */
  background-color: var(--color-amber99);
  border: 2px solid var(--theme-container-low);
  border-radius: 50%;
`

const BadgeLogo = styled(Logo)`
  width: 72%;
  height: 72%;
`

/**
 * A small marker rendered over the corner of a user's avatar to show that the account speaks for
 * ShieldBattery. Position it (usually absolutely, overlapping the avatar's bottom-right corner)
 * via `className`.
 */
export function StaffBadge({ className }: { className?: string }) {
  const { t } = useTranslation()

  return (
    <BadgeRoot
      className={className}
      text={t('users.staffBadge.tooltip', 'ShieldBattery staff')}
      position='top'>
      <BadgeDisc>
        <BadgeLogo />
      </BadgeDisc>
    </BadgeRoot>
  )
}
