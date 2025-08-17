import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useRoute } from 'wouter'
import { urlPath } from '../../../common/urls'
import { SbUser } from '../../../common/users/sb-user'
import { useSelfPermissions } from '../../auth/auth-utils'
import { MaterialIcon } from '../../icons/material/material-icon'
import { IconButton } from '../../material/button'
import { LinkButton } from '../../material/link-button'
import { Tooltip } from '../../material/tooltip'
import { LoadingDotsArea } from '../../progress/dots'
import { bodyLarge } from '../../styles/typography'
import { AdminIpAddressesPage } from './ip-addresses-page'
import { AdminNameHistoryPage } from './name-history-page'
import { AdminPermissionsPage } from './permissions-page'
import { AdminPunishmentsPage } from './punishments-page'

export enum AdminSubPage {
  Permissions = 'permissions',
  Punishments = 'punishments',
  IpAddresses = 'ip-addresses',
  NameHistory = 'name-history',
}

export const ALL_ADMIN_SUB_PAGES: ReadonlyArray<AdminSubPage> = Object.values(AdminSubPage)

const AdminLayoutRoot = styled.div`
  width: 100%;
  margin: 34px 0 0;
  padding: 0 24px;

  display: flex;
  flex-direction: column;
  align-items: center;

  gap: 32px;
`

const AdminNavigation = styled.nav`
  min-width: 0;
  width: auto;

  display: flex;
  flex-direction: row;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const AdminNavLink = styled(LinkButton)<{ $active: boolean }>`
  width: auto;
  height: auto;
  min-height: 0;

  display: flex;

  --_icon-color: ${props => (props.$active ? 'var(--theme-amber)' : 'var(--theme-on-surface)')};
`

const AdminNavIconButton = styled(IconButton)`
  width: 56px;
  height: 56px;
  color: var(--_icon-color);
`

const AdminContent = styled.div`
  flex: 1;
  width: 100%;
`

const LoadingError = styled.div`
  ${bodyLarge};
  width: 100%;
  margin-top: 40px;
  margin-bottom: 48px;
  padding: 0 24px;
`

export interface AdminUserPageLayoutProps {
  user: SbUser
}

export function AdminUserPageLayout({ user }: AdminUserPageLayoutProps) {
  const { t } = useTranslation()
  const selfPermissions = useSelfPermissions()

  const [matches, params] = useRoute<{ adminSubPage?: string }>(
    `/users/:id/:name/admin/:adminSubPage?`,
  )

  const subPageUrl = (subPage: AdminSubPage) =>
    urlPath`/users/${user.id}/${user.name}/admin/${subPage}`

  const canEditPermissions = !!selfPermissions?.editPermissions
  const canBanUsers = !!selfPermissions?.banUsers

  let adminSubPage =
    matches &&
    params?.adminSubPage &&
    ALL_ADMIN_SUB_PAGES.includes(params.adminSubPage as AdminSubPage)
      ? (params.adminSubPage as AdminSubPage)
      : undefined
  adminSubPage =
    adminSubPage ?? (canEditPermissions ? AdminSubPage.Permissions : AdminSubPage.Punishments)

  let content: React.ReactNode
  switch (adminSubPage) {
    case AdminSubPage.Permissions:
      if (!canEditPermissions) {
        content = <LoadingError>Access denied.</LoadingError>
      } else {
        content = <AdminPermissionsPage user={user} />
      }
      break

    case AdminSubPage.Punishments:
      if (!canBanUsers) {
        content = <LoadingError>Access denied.</LoadingError>
      } else {
        content = <AdminPunishmentsPage user={user} />
      }
      break

    case AdminSubPage.IpAddresses:
      if (!canBanUsers) {
        content = <LoadingError>Access denied.</LoadingError>
      } else {
        content = <AdminIpAddressesPage user={user} />
      }
      break

    case AdminSubPage.NameHistory:
      if (!canBanUsers) {
        content = <LoadingError>Access denied.</LoadingError>
      } else {
        content = <AdminNameHistoryPage user={user} />
      }
      break

    default:
      adminSubPage satisfies never
      content = <LoadingError>Invalid admin page.</LoadingError>
  }

  return (
    <AdminLayoutRoot>
      <AdminNavigation>
        <AdminNavItem
          title={t('users.admin.permissions.title', 'Permissions')}
          icon='shield_toggle'
          url={subPageUrl(AdminSubPage.Permissions)}
          show={canEditPermissions}
          active={adminSubPage === AdminSubPage.Permissions}
        />
        <AdminNavItem
          title={t('users.admin.punishments.title', 'Punishments')}
          icon='bomb'
          url={subPageUrl(AdminSubPage.Punishments)}
          show={canBanUsers}
          active={adminSubPage === AdminSubPage.Punishments}
        />
        <AdminNavItem
          title={t('users.admin.ipAddresses.title', 'IP addresses')}
          icon='bring_your_own_ip'
          url={subPageUrl(AdminSubPage.IpAddresses)}
          show={canBanUsers}
          active={adminSubPage === AdminSubPage.IpAddresses}
        />
        <AdminNavItem
          title={t('users.admin.nameHistory.title', 'Name history')}
          icon='badge'
          url={subPageUrl(AdminSubPage.NameHistory)}
          show={canBanUsers}
          active={adminSubPage === AdminSubPage.NameHistory}
        />
      </AdminNavigation>
      <AdminContent>{content ?? <LoadingDotsArea />}</AdminContent>
    </AdminLayoutRoot>
  )
}

function AdminNavItem({
  title,
  icon,
  url,
  show,
  active,
}: {
  title: string
  icon: string
  url: string
  show: boolean
  active: boolean
}) {
  if (!show) return null

  return (
    <Tooltip text={title} position='bottom' tabIndex={-1}>
      <AdminNavLink $active={active} href={url}>
        <AdminNavIconButton icon={<MaterialIcon icon={icon} size={32} />} styledAs='div' />
      </AdminNavLink>
    </Tooltip>
  )
}
