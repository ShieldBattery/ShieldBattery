import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MatchmakingDivision, MatchmakingType } from '../../../common/matchmaking'
import { AssignedRaceChar, RaceChar } from '../../../common/races'
import { MaterialIcon } from '../../icons/material/material-icon'
import { useAppSelector } from '../../redux-hooks'
import { labelSmall } from '../../styles/typography'
import {
  GroupDivider,
  GroupHead,
  GroupHint,
  GroupLabel,
  GroupsContainer,
  LobbyBanner,
  LobbyBannerButton,
  LobbyBannerText,
  ModeGroup,
  ModeList,
  PageHead,
  PageRoot,
  PageSpacer,
  PageSubtitle,
  PageTitle,
  PanelRoot,
  QueueBar,
  QueueChipData,
  RealModeData,
  RowStats,
  RowSummaryState,
  SeasonLabel,
  SettingsDrawer,
  TypeRow,
} from '../find-match'

// ─── Mock data types ──────────────────────────────────────────────────────────

type MockModeId = MatchmakingType | string

interface MockStats {
  mmr: number | null
  division: MatchmakingDivision
  bonus: number
}

interface MockMapPool {
  maps: ReadonlyArray<{ id: string; name: string }>
  vetoes: boolean
  limit: number
}

interface MockModeData {
  id: MockModeId
  label: string
  team: boolean
  group: '1v1' | '2v2' | '3v3'
  desc: string
  stats: MockStats
  mapPool?: MockMapPool
  poolChanged: boolean
}

interface MockModeGroup {
  id: '1v1' | '2v2' | '3v3'
  label: string
  hint: string
}

// ─── Mock map pools ───────────────────────────────────────────────────────────

const VETO_MAPS_1V1 = [
  { id: 'fs', name: 'Fighting Spirit' },
  { id: 'cb', name: 'Circuit Breaker' },
  { id: 'pp', name: 'Polypoid' },
  { id: 'ec', name: 'Eclipse' },
  { id: 'vm', name: 'Vermeer' },
  { id: 'bt', name: 'Butter' },
  { id: 'gl', name: 'Goldenaura' },
  { id: 'at', name: 'Alternative' },
  { id: 'ne', name: 'Neo Sylphid' },
]

const SEL_MAPS_1V1_FASTEST = [
  { id: 'bg1', name: 'Big Game Hunters' },
  { id: 'lt', name: 'Lost Temple' },
  { id: 'dw', name: 'Destination' },
  { id: 'hr', name: 'Heartbreak Ridge' },
  { id: 'py', name: 'Python' },
  { id: 'jd', name: 'Jade' },
]

const VETO_MAPS_2V2 = [
  { id: 'ro', name: 'Rivalry' },
  { id: 'pg', name: 'Power Bond' },
  { id: 'tw', name: 'Twilight' },
  { id: 'ms', name: 'Medusa' },
  { id: 'bh', name: 'Blue Hills' },
  { id: 'ld', name: 'Longinus' },
]

const SEL_MAPS_2V2_FASTEST = [
  { id: 'fs4', name: 'Fastest Map Possible' },
  { id: 'mn', name: 'Money Hunters' },
  { id: 'rf', name: 'Reverse Fastest' },
]

// ─── Mock mode list ───────────────────────────────────────────────────────────

const MOCK_MODE_GROUPS: MockModeGroup[] = [
  { id: '1v1', label: '1v1', hint: 'Solo ranked · race locked before queue' },
  { id: '2v2', label: '2v2', hint: 'Team play · race drafted in-game' },
  { id: '3v3', label: '3v3', hint: 'Team play · race drafted in-game' },
]

const MOCK_MODES: MockModeData[] = [
  // ── 1v1 ─────────────────────────────────────────────────────────────────
  {
    id: MatchmakingType.Match1v1,
    label: '1v1',
    team: false,
    group: '1v1',
    desc: 'Solo · standard maps',
    stats: { mmr: 1842, division: MatchmakingDivision.Diamond3, bonus: 420 },
    mapPool: { maps: VETO_MAPS_1V1, vetoes: true, limit: 3 },
    poolChanged: true,
  },
  {
    id: MatchmakingType.Match1v1Fastest,
    label: '1v1 Fastest',
    team: false,
    group: '1v1',
    desc: 'Solo · Fastest Map',
    stats: { mmr: 1640, division: MatchmakingDivision.Platinum2, bonus: 0 },
    mapPool: { maps: SEL_MAPS_1V1_FASTEST, vetoes: false, limit: 2 },
    poolChanged: false,
  },
  // ── 2v2 ─────────────────────────────────────────────────────────────────
  {
    id: MatchmakingType.Match2v2,
    label: '2v2',
    team: true,
    group: '2v2',
    desc: 'Team · standard maps',
    stats: { mmr: 1985, division: MatchmakingDivision.Diamond2, bonus: 180 },
    mapPool: { maps: VETO_MAPS_2V2, vetoes: true, limit: 2 },
    poolChanged: true,
  },
  {
    id: '2v2bgh',
    label: '2v2 BGH',
    team: true,
    group: '2v2',
    desc: 'Team · Big Game Hunters',
    stats: { mmr: 1240, division: MatchmakingDivision.Bronze1, bonus: 60 },
    poolChanged: false,
  },
  {
    id: '2v2hunters',
    label: '2v2 Hunters',
    team: true,
    group: '2v2',
    desc: 'Team · The Hunters',
    stats: { mmr: 1580, division: MatchmakingDivision.Gold2, bonus: 210 },
    poolChanged: false,
  },
  {
    id: '2v2fastest',
    label: '2v2 Fastest',
    team: true,
    group: '2v2',
    desc: 'Team · Fastest Map',
    stats: { mmr: null, division: MatchmakingDivision.Unrated, bonus: 0 },
    mapPool: { maps: SEL_MAPS_2V2_FASTEST, vetoes: false, limit: 1 },
    poolChanged: false,
  },
  // ── 3v3 ─────────────────────────────────────────────────────────────────
  {
    id: '3v3bgh',
    label: '3v3 BGH',
    team: true,
    group: '3v3',
    desc: 'Team · Big Game Hunters',
    stats: { mmr: 1725, division: MatchmakingDivision.Platinum1, bonus: 320 },
    poolChanged: false,
  },
  {
    id: '3v3hunters',
    label: '3v3 Hunters',
    team: true,
    group: '3v3',
    desc: 'Team · The Hunters',
    stats: { mmr: 1500, division: MatchmakingDivision.Gold1, bonus: 640 },
    poolChanged: false,
  },
  {
    id: '3v3fastest',
    label: '3v3 Fastest',
    team: true,
    group: '3v3',
    desc: 'Team · Fastest Map',
    stats: { mmr: null, division: MatchmakingDivision.Unrated, bonus: 0 },
    poolChanged: false,
  },
]

// ─── Scenario state ───────────────────────────────────────────────────────────

type Scenario = 'idle' | 'in-lobby' | 'some-disabled' | 'searching' | 'multi-searching'

interface MockAvailability {
  nextStartDate?: Date
  nextEndDate?: Date
}

interface ScenarioState {
  selectedIds: Set<MockModeId>
  isSearching: boolean
  inLobby: boolean
  disabledModes: Map<MockModeId, MockAvailability>
}

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000

function buildScenario(scenario: Scenario): ScenarioState {
  const base: ScenarioState = {
    selectedIds: new Set(),
    isSearching: false,
    inLobby: false,
    disabledModes: new Map(),
  }
  switch (scenario) {
    case 'idle':
      return base
    case 'in-lobby':
      return {
        ...base,
        selectedIds: new Set([MatchmakingType.Match1v1]),
        inLobby: true,
      }
    case 'some-disabled':
      return {
        ...base,
        selectedIds: new Set([MatchmakingType.Match1v1]),
        disabledModes: new Map<MockModeId, MockAvailability>([
          [MatchmakingType.Match1v1Fastest, {}],
          [
            MatchmakingType.Match2v2,
            {
              nextStartDate: new Date(Date.now() + THIRTY_DAYS_MS),
              nextEndDate: new Date(Date.now() + THIRTY_DAYS_MS * 2),
            },
          ],
        ]),
      }
    case 'searching':
      return { ...base, selectedIds: new Set([MatchmakingType.Match1v1]), isSearching: true }
    case 'multi-searching':
      return {
        ...base,
        selectedIds: new Set([MatchmakingType.Match1v1, '2v2hunters']),
        isSearching: true,
      }
    default:
      return base
  }
}

// ─── Dev controls ─────────────────────────────────────────────────────────────

const ControlsLabel = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 8px;
`

const ScenarioButtons = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const ScenarioBtn = styled.button<{ $active: boolean }>`
  ${labelSmall};
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid
    ${props => (props.$active ? 'var(--theme-primary)' : 'var(--theme-outline-variant)')};
  background: ${props =>
    props.$active ? 'color-mix(in srgb, var(--theme-primary) 15%, transparent)' : 'transparent'};
  color: ${props => (props.$active ? 'var(--theme-primary)' : 'var(--theme-on-surface-variant)')};
  cursor: pointer;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease;

  &:hover {
    background: color-mix(in srgb, var(--theme-primary) 10%, transparent);
    border-color: var(--theme-primary);
    color: var(--theme-primary);
  }
`

// ─── Per-mode row state (race + map selections for each mode) ─────────────────

interface RowModeState {
  race: RaceChar
  useAlternateRace: boolean
  alternateRace: AssignedRaceChar
  mapSelectionCount: number
}

// ─── Helpers: convert mock data to real component prop shapes ─────────────────

function toRealMode(mode: MockModeData): RealModeData {
  return { type: mode.id as MatchmakingType, group: mode.group, team: mode.team }
}

function toRowStats(mode: MockModeData): RowStats {
  return { division: mode.stats.division, mmr: mode.stats.mmr, bonus: mode.stats.bonus }
}

function toRowSummaryState(mode: MockModeData, rowState: RowModeState): RowSummaryState {
  return {
    race: rowState.race,
    useAlternateRace: rowState.useAlternateRace,
    alternateRace: rowState.alternateRace,
    mapSelectionCount: rowState.mapSelectionCount,
    mapPoolVetoLimit: mode.mapPool?.limit ?? 0,
    mapSelectionStyle: (mode.mapPool?.vetoes ?? false) ? 'veto' : 'pick',
    poolChanged: mode.poolChanged,
  }
}

// ─── Main page ────────────────────────────────────────────────────────────────

const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: 'idle', label: 'Idle' },
  { id: 'in-lobby', label: 'In lobby' },
  { id: 'some-disabled', label: 'Some disabled' },
  { id: 'searching', label: 'Searching' },
  { id: 'multi-searching', label: 'Multi searching' },
]

export function FindMatchListTest() {
  const { t } = useTranslation()

  const [scenario, setScenario] = useState<Scenario>('idle')
  const [state, setState] = useState<ScenarioState>(() => buildScenario('idle'))
  const [drawerModeId, setDrawerModeId] = useState<MockModeId | null>(null)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!state.isSearching) {
      return undefined
    }
    const id = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(id)
  }, [state.isSearching])

  const prefs1v1 = useAppSelector(
    s => s.matchmakingPreferences.byType.get(MatchmakingType.Match1v1)?.preferences as any,
  )
  const prefs1v1Fastest = useAppSelector(
    s => s.matchmakingPreferences.byType.get(MatchmakingType.Match1v1Fastest)?.preferences as any,
  )
  const prefs2v2 = useAppSelector(
    s => s.matchmakingPreferences.byType.get(MatchmakingType.Match2v2)?.preferences as any,
  )

  const getRowModeState = (mode: MockModeData): RowModeState => {
    const id = mode.id
    if (id === MatchmakingType.Match1v1 && prefs1v1) {
      const race: RaceChar = prefs1v1.race ?? 'r'
      return {
        race,
        useAlternateRace: race !== 'r' ? (prefs1v1.data?.useAlternateRace ?? false) : false,
        alternateRace: prefs1v1.data?.alternateRace ?? 'z',
        mapSelectionCount: prefs1v1.mapSelections?.length ?? 0,
      }
    }
    if (id === MatchmakingType.Match1v1Fastest && prefs1v1Fastest) {
      return {
        race: prefs1v1Fastest.race ?? 'r',
        useAlternateRace: false,
        alternateRace: 'z',
        mapSelectionCount: prefs1v1Fastest.mapSelections?.length ?? 0,
      }
    }
    if (id === MatchmakingType.Match2v2 && prefs2v2) {
      return {
        race: prefs2v2.race ?? 'r',
        useAlternateRace: false,
        alternateRace: 'z',
        mapSelectionCount: prefs2v2.mapSelections?.length ?? 0,
      }
    }
    return { race: 'r', useAlternateRace: false, alternateRace: 'z', mapSelectionCount: 0 }
  }

  const handleToggle = (id: MockModeId) => {
    if (state.isSearching) return
    setState(s => {
      const next = new Set(s.selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...s, selectedIds: next }
    })
  }

  const handleOpenSettings = (id: MockModeId) => {
    if (state.isSearching) return
    setDrawerModeId(id)
  }

  const handleFindMatch = () => {
    setState(s => ({ ...s, isSearching: true }))
  }

  const handleSetScenario = (s: Scenario) => {
    setScenario(s)
    setState(buildScenario(s))
    setElapsed(0)
  }

  const handleCancel = () => {
    handleSetScenario('idle')
  }

  const { selectedIds, isSearching, inLobby, disabledModes } = state

  const drawerModeData = drawerModeId ? (MOCK_MODES.find(m => m.id === drawerModeId) ?? null) : null
  let drawerType: MatchmakingType | null = null
  if (drawerModeData !== null) {
    drawerType = (Object.values(MatchmakingType) as string[]).includes(drawerModeData.id as string)
      ? (drawerModeData.id as MatchmakingType)
      : MatchmakingType.Match2v2
  }

  const selectedChips: QueueChipData[] = MOCK_MODES.filter(m => selectedIds.has(m.id)).map(m => ({
    type: m.id as string,
    label: m.label,
    race: getRowModeState(m).race,
  }))

  return (
    <PageRoot>
      <div>
        <ControlsLabel>Scenario</ControlsLabel>
        <ScenarioButtons>
          {SCENARIOS.map(s => (
            <ScenarioBtn
              key={s.id}
              $active={scenario === s.id}
              onClick={() => handleSetScenario(s.id)}>
              {s.label}
            </ScenarioBtn>
          ))}
        </ScenarioButtons>
      </div>

      <PanelRoot>
        <PageHead>
          <div>
            <PageTitle>{t('matchmaking.findMatch.title', 'Find match')}</PageTitle>
            <PageSubtitle>
              {t(
                'matchmaking.findMatch.subtitle',
                'Choose one or more matchmaking types — we\u2019ll queue for them all at once.',
              )}
            </PageSubtitle>
          </div>
          <SeasonLabel>Season 14 · Week 3</SeasonLabel>
        </PageHead>

        {inLobby ? (
          <LobbyBanner>
            <MaterialIcon icon='info' size={20} />
            <LobbyBannerText>
              {t(
                'matchmaking.findMatch.inLobbyBanner',
                'You\u2019re in a lobby \u2014 matchmaking is unavailable while in a game lobby.',
              )}
            </LobbyBannerText>
            <LobbyBannerButton
              label={t('matchmaking.findMatch.goToLobby', 'Go to lobby')}
              onClick={() => {}}
            />
          </LobbyBanner>
        ) : null}

        <GroupsContainer>
          {MOCK_MODE_GROUPS.map(group => {
            const modes = MOCK_MODES.filter(m => m.group === group.id)
            return (
              <ModeGroup key={group.id}>
                <GroupHead>
                  <GroupLabel>{group.label}</GroupLabel>
                  <GroupDivider />
                  <GroupHint>{group.hint}</GroupHint>
                </GroupHead>
                <ModeList>
                  {modes.map(mode => {
                    const rowState = getRowModeState(mode)
                    const availability = disabledModes.get(mode.id)
                    return (
                      <TypeRow
                        key={String(mode.id)}
                        mode={toRealMode(mode)}
                        label={mode.label}
                        desc={mode.desc}
                        selected={selectedIds.has(mode.id)}
                        isSearching={isSearching}
                        isEnabled={!disabledModes.has(mode.id)}
                        nextStartDate={availability?.nextStartDate}
                        nextEndDate={availability?.nextEndDate}
                        stats={toRowStats(mode)}
                        summaryState={toRowSummaryState(mode, rowState)}
                        t={t}
                        onToggle={() => handleToggle(mode.id)}
                        onOpenSettings={() => handleOpenSettings(mode.id)}
                      />
                    )
                  })}
                </ModeList>
              </ModeGroup>
            )
          })}
        </GroupsContainer>

        <QueueBar
          selectedChips={selectedChips}
          isSearching={isSearching}
          elapsedSecs={elapsed}
          disabled={selectedIds.size === 0 || inLobby}
          onFindMatch={handleFindMatch}
          onCancel={handleCancel}
        />
      </PanelRoot>

      <PageSpacer />

      <SettingsDrawer
        drawerType={drawerType}
        labelForType={_ => drawerModeData?.label ?? ''}
        onClose={() => setDrawerModeId(null)}
      />
    </PageRoot>
  )
}
