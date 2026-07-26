import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { ConnectedAvatar } from '../avatars/avatar'
import Logo from '../logos/logo-no-bg.svg'
import { elevationPlus2 } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { useAppSelector } from '../redux-hooks'

const BadgeRoot = styled(Tooltip)`
  width: 22px;
  height: 22px;
  display: flex;
`

const BadgeDisc = styled.div`
  ${elevationPlus2};

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
  border: 2px solid var(--color-blue90);
  border-radius: 50%;
`

const BadgeLogo = styled(Logo)`
  width: 90%;
  height: 90%;
`

/**
 * The raw staff badge coin: a ShieldBattery logo on a navy disc, shown to mark that an account
 * speaks for ShieldBattery. This is the bare mark with no positioning of its own — most callers
 * want `StaffBadgedAvatar` instead, which anchors it over an avatar automatically.
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

const BadgedAvatarRoot = styled.div`
  position: relative;
  flex-shrink: 0;
`

const FillingAvatar = styled(ConnectedAvatar)`
  width: 100%;
  height: 100%;
`

const CornerBadge = styled(StaffBadge)`
  position: absolute;
  /* Sized/offset relative to the avatar so the composite works at any avatar size, capped at
     the badge's native size so it never grows past the design on large avatars. */
  width: 55%;
  height: 55%;
  max-width: 22px;
  max-height: 22px;
  top: -10%;
  right: -14%;
`

/**
 * A user's avatar with the staff badge anchored over its top-right corner when the account has
 * one (bottom-right is reserved for presence status). Renders a plain avatar for everyone else.
 * Size it by setting width/height via `className` — the badge scales with it.
 */
export function StaffBadgedAvatar({ userId, className }: { userId: SbUserId; className?: string }) {
  const hasStaffBadge = useAppSelector(s => s.users.byId.get(userId)?.staffBadge ?? false)

  return (
    <BadgedAvatarRoot className={className}>
      <FillingAvatar userId={userId} />
      {hasStaffBadge ? <CornerBadge /> : null}
    </BadgedAvatarRoot>
  )
}
