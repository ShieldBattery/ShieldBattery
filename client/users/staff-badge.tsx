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
    The logo's shield body inherits currentColor (the global svg fill), so it must be set
    explicitly here: a light shield + the mark's own amber bolt on a saturated navy disc, like a
    miniature app icon. The bright ring frames the coin against both the avatar behind it and the
    surface the avatar sits on.
  */
  color: var(--color-blue99);
  background-color: var(--color-blue40);
  border: 2px solid var(--color-amber60);
  border-radius: 50%;
`

const BadgeLogo = styled(Logo)`
  width: 90%;
  height: 90%;
`

/**
 * A small marker rendered over the corner of a user's avatar to show that the account speaks for
 * ShieldBattery. Position it (usually absolutely, overlapping the avatar's top-right corner —
 * bottom-right is reserved for presence status) via `className`.
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
