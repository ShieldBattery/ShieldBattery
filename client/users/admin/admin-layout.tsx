import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useRoute } from 'wouter'
import { urlPath } from '../../../common/urls'
import { SbUser } from '../../../common/users/sb-user'
import { useSelfPermissions } from '../../auth/auth-utils'
import { IconButton } from '../../material/button'
import { LinkButton } from '../../material/link-button'
import { Tooltip } from '../../material/tooltip'
import { LoadingDotsArea } from '../../progress/dots'
import { bodyLarge } from '../../styles/typography'
import { AdminIpAddressesPage } from './ip-addresses-page'
import { AdminPermissionsPage } from './permissions-page'
import { AdminPunishmentsPage } from './punishments-page'

export enum AdminSubPage {
  Permissions = 'permissions',
  Punishments = 'punishments',
  IpAddresses = 'ip-addresses',
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

  if (!canEditPermissions && !canBanUsers) {
    return <LoadingError>Access denied.</LoadingError>
  }

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

    default:
      adminSubPage satisfies never
      content = <LoadingError>Invalid admin page.</LoadingError>
  }

  return (
    <AdminLayoutRoot>
      <AdminNavigation>
        {canEditPermissions && (
          <Tooltip
            text={t('users.admin.permissions', 'Permissions')}
            position='bottom'
            tabIndex={-1}>
            <AdminNavLink
              $active={adminSubPage === AdminSubPage.Permissions}
              href={subPageUrl(AdminSubPage.Permissions)}>
              <AdminNavIconButton icon='shield_toggle' styledAs='div' />
            </AdminNavLink>
          </Tooltip>
        )}
        {canBanUsers && (
          <Tooltip
            text={t('users.admin.punishments', 'Punishments')}
            position='bottom'
            tabIndex={-1}>
            <AdminNavLink
              data-test='punishments-button'
              $active={adminSubPage === AdminSubPage.Punishments}
              href={subPageUrl(AdminSubPage.Punishments)}>
              <AdminNavIconButton icon='bomb' styledAs='div' />
            </AdminNavLink>
          </Tooltip>
        )}
        {canBanUsers && (
          <Tooltip
            text={t('users.admin.ipAddresses', 'IP addresses')}
            position='bottom'
            tabIndex={-1}>
            <AdminNavLink
              $active={adminSubPage === AdminSubPage.IpAddresses}
              href={subPageUrl(AdminSubPage.IpAddresses)}>
              <AdminNavIconButton icon='bring_your_own_ip' styledAs='div' />
            </AdminNavLink>
          </Tooltip>
        )}
      </AdminNavigation>
      <AdminContent>{content ?? <LoadingDotsArea />}</AdminContent>
    </AdminLayoutRoot>
  )
}
