import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import styled, { css } from 'styled-components'
import { MainLayout } from '../../../main-layout'
import { loadMapsForTesting } from '../../../maps/devonly/maps-for-testing'
import { isConnectedAtom } from '../../../network/network-atoms'
import { useAppDispatch } from '../../../redux-hooks'
import { ContainerLevel, containerStyles } from '../../../styles/colors'
import { bodyLarge, labelLarge, labelSmall } from '../../../styles/typography'
import { InGamePanel, LaunchingPanel, MapVoteStrip, RegroupPanel } from './lifecycle-panels'
import { LobbyChat } from './lobby-chat'
import { LobbyHeader } from './lobby-header'
import { buildLobbyView, LobbyView, SCENARIOS, VIEWER_ROLES } from './lobby-model'
import {
  ALL_MOCK_MAPS,
  ALL_MOCK_USERS,
  getScenarioData,
  RedesignScenario,
  ViewerRole,
} from './mock-data'
import { RosterRail } from './roster-rail'

const DEV_BAR_HEIGHT_PX = 44

const Content = styled.div`
  grid-area: content;
  padding-bottom: ${DEV_BAR_HEIGHT_PX}px;

  display: flex;
  overflow: hidden;
`

const Page = styled.div`
  width: 100%;
  max-width: 1200px;
  height: 100%;
  margin: 0 auto;

  display: flex;
  flex-direction: column;

  overflow: hidden;
`

const Body = styled.div`
  flex-grow: 1;
  min-height: 0;

  display: flex;
`

const ChatColumn = styled.div`
  flex-grow: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
`

const AwayArea = styled.div`
  ${bodyLarge};

  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;

  color: rgb(from var(--theme-on-surface) r g b / 0.4);
  text-align: center;
`

// --- dev controls ------------------------------------------------------------------------------

const DevBar = styled.div`
  ${containerStyles(ContainerLevel.High)};

  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: ${DEV_BAR_HEIGHT_PX}px;
  padding-inline: 12px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-top: 1px solid var(--theme-outline-variant);
  overflow-x: auto;
  z-index: 100;
`

const DevLabel = styled.div`
  ${labelSmall};

  flex-shrink: 0;

  color: var(--theme-on-surface-variant);
  letter-spacing: 0.1em;
  text-transform: uppercase;
`

const DevDivider = styled.div`
  width: 1px;
  height: 20px;
  flex-shrink: 0;

  background-color: var(--theme-outline-variant);
`

const DevButton = styled.button<{ $active: boolean }>`
  ${labelLarge};

  height: 26px;
  flex-shrink: 0;
  padding-inline: 10px;

  border-radius: 13px;
  cursor: pointer;

  ${props =>
    props.$active
      ? css`
          background-color: rgb(from var(--theme-primary) r g b / 0.24);
          border: 1px solid var(--theme-primary);
          color: var(--theme-primary);
        `
      : css`
          background-color: transparent;
          border: 1px solid var(--theme-outline-variant);
          color: var(--theme-on-surface-variant);
        `}
`

function DevChoice<T extends string>({
  label,
  options,
  active,
  onChange,
}: {
  label: string
  options: ReadonlyArray<{ id: T; label: string }>
  active: T
  onChange: (value: T) => void
}) {
  return (
    <>
      <DevLabel>{label}</DevLabel>
      {options.map(option => (
        <DevButton
          key={option.id}
          $active={option.id === active}
          onClick={() => onChange(option.id)}>
          {option.label}
        </DevButton>
      ))}
    </>
  )
}

// --- page --------------------------------------------------------------------------------------

function LobbyRoom({ view, onToggleReady }: { view: LobbyView; onToggleReady: () => void }) {
  const { lifecycle } = view

  return (
    <Page>
      <LobbyHeader view={view} onToggleReady={onToggleReady} />
      <Body>
        <ChatColumn>
          {lifecycle === 'launching' ? <LaunchingPanel view={view} /> : null}
          {lifecycle === 'inGame' ? <InGamePanel view={view} /> : null}
          {lifecycle === 'regroup' ? <RegroupPanel view={view} /> : null}
          <LobbyChat
            view={view}
            placeholder={
              lifecycle === 'inGame' ? 'Chat with the others waiting' : `Message ${view.lobby.name}`
            }
          />
          {lifecycle === 'inGame' ? <MapVoteStrip view={view} /> : null}
        </ChatColumn>
        <RosterRail view={view} />
      </Body>
    </Page>
  )
}

function NavigatedAway() {
  const isConnected = useAtomValue(isConnectedAtom)

  return (
    <AwayArea>
      <div>You're elsewhere in the app — the lobby follows via the widget.</div>
      {isConnected ? null : (
        <div>(Sign in and connect to see it — the widget only shows on a live connection.)</div>
      )}
    </AwayArea>
  )
}

/**
 * The in-lobby redesign exploration: the lobby as a room, rendered inside the app's real chrome so
 * it can be judged next to the app it lives in. The bar along the bottom is the only part that
 * isn't the design — it picks which moment of a lobby's evening, and whose seat, to render from.
 */
export default function LobbyRedesign() {
  const dispatch = useAppDispatch()
  const [scenario, setScenario] = useState<RedesignScenario>('gathering')
  const [role, setRole] = useState<ViewerRole>('host')
  const [readyChecks, setReadyChecks] = useState(true)
  const [selfReady, setSelfReady] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    dispatch(loadMapsForTesting())
    dispatch({ type: '@maps/loadMapInfos', payload: ALL_MOCK_MAPS })
    dispatch({ type: '@users/loadUsers', payload: ALL_MOCK_USERS })
  }, [dispatch])

  const data = getScenarioData(scenario)
  const away = scenario === 'navigatedAway'

  // Putting the mock lobby into the real lobby state is what makes the app's own
  // GameplayActivityWidget appear: it renders whenever we're in a lobby and not on a lobby route.
  useEffect(() => {
    if (!away) {
      return () => {}
    }

    dispatch({
      type: '@lobbies/init',
      payload: { type: 'init', lobby: data.lobby, userInfos: ALL_MOCK_USERS },
    })
    return () => {
      dispatch({ type: '@lobbies/updateLeaveSelf' })
    }
  }, [away, data.lobby, dispatch])

  const view = buildLobbyView({ data, role, readyChecks, selfReady })

  return (
    <>
      <MainLayout>
        <Content>
          {away ? (
            <NavigatedAway />
          ) : (
            <LobbyRoom view={view} onToggleReady={() => setSelfReady(!view.viewer.isReady)} />
          )}
        </Content>
      </MainLayout>
      <DevBar>
        <DevChoice
          label='Scenario'
          options={SCENARIOS}
          active={scenario}
          onChange={value => {
            setScenario(value)
            setSelfReady(undefined)
          }}
        />
        <DevDivider />
        <DevChoice
          label='Viewing as'
          options={VIEWER_ROLES}
          active={role}
          onChange={value => {
            setRole(value)
            setSelfReady(undefined)
          }}
        />
        <DevDivider />
        <DevLabel>Ready checks</DevLabel>
        <DevButton $active={readyChecks} onClick={() => setReadyChecks(!readyChecks)}>
          {readyChecks ? 'On' : 'Off'}
        </DevButton>
      </DevBar>
    </>
  )
}
