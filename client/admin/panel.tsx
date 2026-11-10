import { useAtomValue } from 'jotai'
import * as React from 'react'
import { Suspense } from 'react'
import styled from 'styled-components'
import { Link, Redirect, Route, Switch } from 'wouter'
import { ADMIN_REPORT_COUNT_MAX, AdminReportKind } from '../../common/admin-report-counts'
import { useSelfPermissions } from '../auth/auth-utils'
import { MaterialIcon } from '../icons/material/material-icon'
import { LoadingDotsArea } from '../progress/dots'
import { CenteredContentContainer } from '../styles/centered-container'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { bodySmall, labelMedium, titleLarge, titleSmall } from '../styles/typography'
import { useCountInWindow } from './admin-report-counts'
import { adminReportTimesAtom } from './admin-report-counts-atoms'

const LoadableBugReports = React.lazy(async () => ({
  default: (await import('../bugs/admin-bug-reports')).AdminBugReports,
}))
const LoadableManageNews = React.lazy(async () => ({
  default: (await import('./admin-news')).AdminNews,
}))
const LoadableGameReports = React.lazy(async () => ({
  default: (await import('../games/admin-game-reports')).AdminGameReports,
}))
const LoadableReviewRequests = React.lazy(async () => ({
  default: (await import('../games/admin-review-requests')).AdminReviewRequests,
}))
const LoadableMapManager = IS_ELECTRON
  ? React.lazy(async () => ({
      default: (await import('./map-manager')).AdminMapManager,
    }))
  : () => null
const LoadableMapPools = React.lazy(async () => ({
  default: (await import('../matchmaking/admin-map-pools')).AdminMatchmakingMapPools,
}))
const LoadableLiveStreams = React.lazy(async () => ({
  default: (await import('./live-streams')).AdminLiveStreams,
}))
const LoadableModerationActions = React.lazy(async () => ({
  default: (await import('./moderation-actions')).AdminModerationActions,
}))
const LoadableMatchmakingConfig = React.lazy(async () => ({
  default: (await import('./matchmaking-config')).AdminMatchmakingConfig,
}))
const LoadableMatchmakingSeasons = React.lazy(async () => ({
  default: (await import('./matchmaking-seasons')).AdminMatchmakingSeasons,
}))
const LoadableMatchmakingTimes = React.lazy(async () => ({
  default: (await import('../matchmaking/admin-matchmaking-times')).AdminMatchmakingTimes,
}))
const LoadableRestrictedNames = React.lazy(async () => ({
  default: (await import('./restricted-names')).RestrictedNames,
}))
const LoadableSignupCodes = React.lazy(async () => ({
  default: (await import('./signup-codes')).SignupCodes,
}))
const LoadableUrgentMessage = React.lazy(async () => ({
  default: (await import('./urgent-message')).AdminUrgentMessage,
}))

interface AdminPage {
  path: string
  allowed: boolean
  Component: React.ComponentType
  title: string
  description: string
  icon: string
  /** Unresolved reports of this kind are counted on the page's card. */
  reportKind?: AdminReportKind
}

interface AdminSection {
  title: string
  pages: AdminPage[]
}

const Root = styled.div`
  padding-block: 24px 48px;

  display: flex;
  flex-direction: column;
  gap: 32px;
`

const Title = styled.div`
  ${titleLarge};
`

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const SectionTitle = styled.h2`
  ${titleSmall};
  margin: 0;
  color: var(--theme-on-surface-variant);
`

const CardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
  gap: 12px;
`

const PageCard = styled(Link)`
  ${containerStyles(ContainerLevel.Low)};

  position: relative;
  padding: 16px;

  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: 16px;
  row-gap: 2px;
  align-items: center;

  border-radius: 8px;
  transition: background-color 150ms linear;

  &:link,
  &:visited,
  &:hover,
  &:active {
    color: var(--theme-on-surface);
    text-decoration: none;
  }

  &:hover {
    ${containerStyles(ContainerLevel.Normal)};
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const IconTile = styled.div`
  grid-row: 1 / 3;
  width: 40px;
  height: 40px;

  display: flex;
  align-items: center;
  justify-content: center;

  background-color: var(--theme-grey-blue-container);
  color: var(--theme-on-grey-blue-container);
  border-radius: 8px;
`

const CardTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`

const CardTitle = styled.div`
  ${titleSmall};
`

const CardDescription = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const PendingCount = styled.span`
  ${labelMedium};
  height: 20px;
  padding: 0 8px;

  display: inline-flex;
  align-items: center;

  background-color: var(--theme-amber-container);
  color: var(--theme-on-amber-container);
  border-radius: 10px;
`

function ReportCountBadge({ kind }: { kind: AdminReportKind }) {
  const times = useAtomValue(adminReportTimesAtom)
  const count = useCountInWindow(times[kind])
  if (!count) {
    return null
  }

  const countText = count >= ADMIN_REPORT_COUNT_MAX ? `${ADMIN_REPORT_COUNT_MAX - 1}+` : `${count}`
  return <PendingCount title='Unresolved in the last day'>{countText}</PendingCount>
}

function AdminIndex({ sections }: { sections: ReadonlyArray<AdminSection> }) {
  return (
    <CenteredContentContainer>
      <Root>
        <Title>Admin</Title>
        {sections.map(section => {
          const pages = section.pages.filter(p => p.allowed)
          return pages.length ? (
            <Section key={section.title}>
              <SectionTitle>{section.title}</SectionTitle>
              <CardGrid>
                {pages.map(page => (
                  <PageCard key={page.path} href={page.path}>
                    <IconTile>
                      <MaterialIcon icon={page.icon} size={24} />
                    </IconTile>
                    <CardTitleRow>
                      <CardTitle>{page.title}</CardTitle>
                      {page.reportKind ? <ReportCountBadge kind={page.reportKind} /> : null}
                    </CardTitleRow>
                    <CardDescription>{page.description}</CardDescription>
                  </PageCard>
                ))}
              </CardGrid>
            </Section>
          ) : null
        })}
      </Root>
    </CenteredContentContainer>
  )
}

export default function AdminPanel() {
  const perms = useSelfPermissions()

  const sections: AdminSection[] = [
    {
      title: 'Moderation',
      pages: [
        {
          path: '/admin/moderation-actions',
          allowed: !!perms?.banUsers,
          Component: LoadableModerationActions,
          title: 'Moderation actions',
          description: 'Recent bans, restrictions, and matchmaking timeouts',
          icon: 'manage_history',
        },
        {
          path: '/admin/game-reports',
          allowed: !!perms?.manageGameReports,
          Component: LoadableGameReports,
          title: 'Game reports',
          description: 'Players reported by others after their games',
          icon: 'flag',
          reportKind: 'gameReports',
        },
        {
          path: '/admin/review-requests',
          allowed: !!perms?.manageGameReports,
          Component: LoadableReviewRequests,
          title: 'Review requests',
          description: 'Disputed matchmaking results awaiting a decision',
          icon: 'gavel',
          reportKind: 'reviewRequests',
        },
        {
          path: '/admin/restricted-names',
          allowed: !!perms?.manageRestrictedNames,
          Component: LoadableRestrictedNames,
          title: 'Restricted names',
          description: 'Names and patterns players can’t use',
          icon: 'block',
        },
      ],
    },
    {
      title: 'Matchmaking',
      pages: [
        {
          path: '/admin/matchmaking-config',
          allowed: !!perms?.manageMatchmaking,
          Component: LoadableMatchmakingConfig,
          title: 'Config',
          description: 'Tuning values for matchmaking and ratings',
          icon: 'tune',
        },
        {
          path: '/admin/matchmaking-seasons',
          allowed: !!perms?.manageMatchmakingSeasons,
          Component: LoadableMatchmakingSeasons,
          title: 'Seasons',
          description: 'Schedule and manage ranked seasons',
          icon: 'calendar_month',
        },
        {
          path: '/admin/matchmaking-times',
          allowed: !!perms?.manageMatchmakingTimes,
          Component: LoadableMatchmakingTimes,
          title: 'Times',
          description: 'When each matchmaking queue is open',
          icon: 'schedule',
        },
        {
          path: '/admin/map-pools',
          allowed: !!perms?.manageMapPools,
          Component: LoadableMapPools,
          title: 'Map pools',
          description: 'Maps in rotation for each matchmaking type',
          icon: 'map',
        },
      ],
    },
    {
      title: 'Content',
      pages: [
        {
          path: '/admin/news',
          allowed: !!perms?.manageNews,
          Component: LoadableManageNews,
          title: 'News',
          description: 'Write and publish news posts',
          icon: 'newspaper',
        },
        {
          path: '/admin/urgent-message',
          allowed: !!perms?.manageNews,
          Component: LoadableUrgentMessage,
          title: 'Urgent message',
          description: 'A banner shown to everyone on the site',
          icon: 'campaign',
        },
        {
          path: '/admin/live-streams',
          allowed: !!perms?.manageLiveStreams,
          Component: LoadableLiveStreams,
          title: 'Live streams',
          description: 'Which streams are featured on the site',
          icon: 'live_tv',
        },
        {
          path: '/admin/map-manager',
          // The map manager needs local file access, so it only exists in the app
          allowed: IS_ELECTRON && !!(perms?.manageMaps || perms?.massDeleteMaps),
          Component: LoadableMapManager,
          title: 'Maps',
          description: 'Upload and remove maps',
          icon: 'landscape',
        },
      ],
    },
    {
      title: 'Support',
      pages: [
        {
          path: '/admin/bug-reports',
          allowed: !!perms?.manageBugReports,
          Component: LoadableBugReports,
          title: 'Bug reports',
          description: 'Reports submitted from the app, with logs',
          icon: 'bug_report',
          reportKind: 'bugReports',
        },
        {
          path: '/admin/signup-codes',
          allowed: !!perms?.manageSignupCodes,
          Component: LoadableSignupCodes,
          title: 'Signup codes',
          description: 'Codes that allow creating an account',
          icon: 'key',
        },
      ],
    },
  ]

  return (
    <Suspense fallback={<LoadingDotsArea />}>
      <Switch>
        {sections
          .flatMap(s => s.pages)
          .map(({ path, allowed, Component }) => (
            <Route path={path + '/*?'} key={path}>
              {allowed ? <Component /> : <Redirect to='/' />}
            </Route>
          ))}

        <Route path='/admin/*?'>
          <AdminIndex sections={sections} />
        </Route>
      </Switch>
    </Suspense>
  )
}
