import { ReactNode, useEffect, useState } from 'react'
import styled from 'styled-components'
import { ConnectedAvatar } from '../../../avatars/avatar'
import { MaterialIcon } from '../../../icons/material/material-icon'
import { loadMapsForTesting } from '../../../maps/devonly/maps-for-testing'
import { useAppDispatch } from '../../../redux-hooks'
import { ContainerLevel, containerStyles } from '../../../styles/colors'
import { labelMedium, labelSmall, singleLine, titleSmall } from '../../../styles/typography'
import { ScenarioPicker } from '../scenario-picker'
import {
  ALL_MOCK_MAPS,
  ALL_MOCK_USERS,
  getScenarioData,
  RedesignScenario,
  ScenarioData,
  ViewerRole,
} from './mock-data'

const SCENARIOS: ReadonlyArray<{ id: RedesignScenario; label: string }> = [
  { id: 'gathering', label: 'Gathering' },
  { id: 'fullWithBench', label: 'Full + bench' },
  { id: 'countdown', label: 'Countdown' },
  { id: 'inGame', label: 'In game' },
  { id: 'regroup', label: 'Regroup' },
  { id: 'settingsChanged', label: 'Settings changed' },
]

const VIEWER_ROLES: ReadonlyArray<{ id: ViewerRole; label: string }> = [
  { id: 'host', label: 'Host' },
  { id: 'member', label: 'Member' },
  { id: 'benched', label: 'Benched' },
]

/** Mirrors the icon choices `main-layout.tsx` uses for these same activities. */
const NAV_ITEMS: ReadonlyArray<{ icon: string; label: string }> = [
  { icon: 'home', label: 'Home' },
  { icon: 'strategy', label: 'Games' },
  { icon: 'map', label: 'Maps' },
  { icon: 'military_tech', label: 'Ladder' },
  { icon: 'social_leaderboard', label: 'Leagues' },
]

const WHISPER_USERS = ALL_MOCK_USERS.filter(u => u.name === 'Jaedong' || u.name === 'Stork')

const Root = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background-color: var(--theme-container-lowest);
`

const TopBar = styled.div`
  ${containerStyles(ContainerLevel.Low)};
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 24px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--theme-outline-variant);
`

const Shell = styled.div`
  flex-grow: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
`

const NavRail = styled.nav`
  flex-shrink: 0;
  width: 88px;
  padding-top: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background-color: var(--theme-container-low);
  border-right: 1px solid var(--theme-outline-variant);
`

const NavItem = styled.div`
  width: 72px;
  padding: 10px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  border-radius: 12px;
  color: var(--theme-on-surface-variant);
`

const NavLabel = styled.span`
  ${labelSmall};
`

const MainColumn = styled.div`
  flex-grow: 1;
  min-width: 0;
  overflow: auto;
`

const SocialSidebarMock = styled.div`
  flex-shrink: 0;
  width: 280px;
  padding-block: 12px;
  overflow-y: auto;
  background-color: var(--theme-container-lowest);
  border-left: 1px solid var(--theme-outline-variant);
`

const SidebarHeader = styled.div`
  ${labelMedium};
  padding-inline: 16px 8px;
  margin: 8px 0 4px;
  color: var(--theme-on-surface-variant);
`

const SidebarDivider = styled.hr`
  margin: 12px 16px;
  border: none;
  border-top: 1px solid var(--theme-outline-variant);
`

const SidebarRow = styled.div`
  padding-inline: 16px;
  height: 48px;
  display: flex;
  align-items: center;
  gap: 12px;
`

const SidebarIcon = styled.div`
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--theme-on-surface-variant);
`

const SidebarAvatar = styled(ConnectedAvatar)`
  width: 28px;
  height: 28px;
  flex-shrink: 0;
`

const SidebarText = styled.span`
  ${titleSmall};
  ${singleLine};
  overflow: hidden;
`

export interface ExplorationFrameProps {
  /** Renders the variant's main column for the currently selected scenario + viewer role. */
  children: (data: ScenarioData, viewer: ViewerRole) => ReactNode
  /**
   * Lets a variant (namely "Room") inject its lobby's entry at the top of the mock social
   * sidebar, above the chat-channel list — the lobby outranks channels while you're in one.
   */
  sidebarSlot?: (data: ScenarioData, viewer: ViewerRole) => ReactNode
}

/**
 * The shared page frame every in-lobby redesign exploration variant renders inside: a scenario +
 * viewer-role switcher above a mock app shell (left nav rail, main column, social sidebar), so Q2
 * (how the lobby coexists with the rest of the app's chrome) has real context to answer against.
 */
export function ExplorationFrame({ children, sidebarSlot }: ExplorationFrameProps) {
  const dispatch = useAppDispatch()
  const [scenario, setScenario] = useState<RedesignScenario>('gathering')
  const [viewer, setViewer] = useState<ViewerRole>('host')

  useEffect(() => {
    dispatch(loadMapsForTesting())
    dispatch({ type: '@maps/loadMapInfos', payload: ALL_MOCK_MAPS })
    dispatch({ type: '@users/loadUsers', payload: ALL_MOCK_USERS })
  }, [dispatch])

  const data = getScenarioData(scenario)

  return (
    <Root>
      <TopBar>
        <ScenarioPicker scenarios={SCENARIOS} active={scenario} onChange={setScenario} />
        <ScenarioPicker
          label='Viewing as'
          scenarios={VIEWER_ROLES}
          active={viewer}
          onChange={setViewer}
        />
      </TopBar>
      <Shell>
        <NavRail>
          {NAV_ITEMS.map(item => (
            <NavItem key={item.icon}>
              <MaterialIcon icon={item.icon} />
              <NavLabel>{item.label}</NavLabel>
            </NavItem>
          ))}
        </NavRail>
        <MainColumn>{children(data, viewer)}</MainColumn>
        <SocialSidebarMock>
          {sidebarSlot?.(data, viewer)}
          <SidebarHeader>Chat channels</SidebarHeader>
          <SidebarRow>
            <SidebarIcon>
              <MaterialIcon icon='tag' size={20} />
            </SidebarIcon>
            <SidebarText>ShieldBattery</SidebarText>
          </SidebarRow>
          <SidebarDivider />
          <SidebarHeader>Whispers</SidebarHeader>
          {WHISPER_USERS.map(user => (
            <SidebarRow key={user.id}>
              <SidebarAvatar userId={user.id} />
              <SidebarText>{user.name}</SidebarText>
            </SidebarRow>
          ))}
        </SocialSidebarMock>
      </Shell>
    </Root>
  )
}
