import { useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import styled from 'styled-components'
import { AssignedRaceChar } from '../../../common/races'
import { MaterialIcon } from '../../icons/material/material-icon'
import { SelectOption } from '../../material/select/option'
import { Select } from '../../material/select/select'
import { TabItem, Tabs } from '../../material/tabs'
import { getRaceColor } from '../../styles/colors'
import {
  bodyMedium,
  bodySmall,
  labelMedium,
  labelSmall,
  singleLine,
  titleLarge,
  titleMedium,
  titleSmall,
} from '../../styles/typography'
import {
  ALL_MAPS,
  ALL_MODES,
  ALL_SEASONS,
  BEST_ALLIES,
  DivisionBand,
  MODES_BY_PLAYTIME,
  MatchupCell,
  ModeStats,
  RIVALS,
  RatingPoint,
  RivalEntry,
  SEASONS,
  TOUGHEST_OPPONENTS,
  currentBonusPool,
  divisionBands,
  mapStats,
  mapsFor,
  matchupCell,
  raceCombos,
  splitOnDiscontinuity,
  teamSizeFor,
} from './stats-data'

enum StatsSection {
  Rating = 'rating',
  Rivals = 'rivals',
  Matchups = 'matchups',
}

const Container = styled.div`
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
`

// Wrapped rather than styled(Tabs): styling the component directly erases its
// generic parameter, which loses the type of the tab values.
const TabsArea = styled.div`
  max-width: 480px;
`

// --- Rating ---------------------------------------------------------------

const ModeList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const ModeCard = styled.div`
  background: var(--theme-container-low);
  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
  overflow: hidden;
`

const ModeHeader = styled.button`
  width: 100%;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 16px;

  background: none;
  border: none;
  color: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--theme-container);
  }
`

const ModeTitle = styled.div`
  ${titleMedium};
  ${singleLine};
`

const ModeSub = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const Grow = styled.div`
  flex-grow: 1;
  min-width: 0;
`

const Metric = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
`

const MetricValue = styled.div`
  ${titleLarge};
  font-variant-numeric: tabular-nums;
`

const Delta = styled.div<{ $positive: boolean }>`
  ${labelMedium};
  font-variant-numeric: tabular-nums;
  color: ${props => (props.$positive ? 'var(--theme-positive)' : 'var(--theme-negative)')};
`

const Caret = styled(MaterialIcon).attrs({ icon: 'expand_more' })<{ $open: boolean }>`
  color: var(--theme-on-surface-variant);
  transform: ${props => (props.$open ? 'rotate(180deg)' : 'none')};
  transition: transform 150ms ease;
`

const CardBody = styled.div`
  padding: 4px 16px 16px;
  border-top: 1px solid var(--theme-outline-variant);
`

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 12px 0;
`

const Chip = styled.button<{ $active: boolean }>`
  ${labelMedium};
  padding: 5px 12px;
  border-radius: 999px;
  cursor: pointer;

  background: ${props => (props.$active ? 'var(--theme-container-highest)' : 'transparent')};
  border: 1px solid
    ${props => (props.$active ? 'var(--theme-primary)' : 'var(--theme-outline-variant)')};
  color: ${props =>
    props.$active ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)'};
`

const ChartArea = styled.div`
  width: 100%;
  height: 260px;
`

type Metric = 'rating' | 'points'

function RatingSection() {
  const [open, setOpen] = useState<string>(MODES_BY_PLAYTIME[0].key)

  return (
    <ModeList>
      {MODES_BY_PLAYTIME.map(mode => (
        <ModeCardView
          key={mode.key}
          mode={mode}
          open={open === mode.key}
          onToggle={() => setOpen(open === mode.key ? '' : mode.key)}
        />
      ))}
    </ModeList>
  )
}

function ModeCardView({
  mode,
  open,
  onToggle,
}: {
  mode: ModeStats
  open: boolean
  onToggle: () => void
}) {
  const [metric, setMetric] = useState<Metric>('rating')
  const [season, setSeason] = useState<string>(ALL_SEASONS)

  const history =
    season === ALL_SEASONS ? mode.history : mode.history.filter(p => p.season === Number(season))
  // Points restart every season; rating only breaks where a season reset it.
  const runs = splitOnDiscontinuity(history, metric === 'points')

  return (
    <ModeCard>
      <ModeHeader onClick={onToggle} aria-expanded={open}>
        <Grow>
          <ModeTitle>{mode.label}</ModeTitle>
          <ModeSub>{mode.games} games</ModeSub>
        </Grow>
        <Metric>
          <MetricValue>{mode.rating}</MetricValue>
          <Delta $positive={mode.seasonDelta >= 0}>
            {mode.seasonDelta >= 0 ? '▲' : '▼'} {Math.abs(mode.seasonDelta)} this season
          </Delta>
        </Metric>
        <Caret $open={open} />
      </ModeHeader>

      {open ? (
        <CardBody>
          <ChipRow>
            <Chip $active={metric === 'rating'} onClick={() => setMetric('rating')}>
              Rating
            </Chip>
            <Chip $active={metric === 'points'} onClick={() => setMetric('points')}>
              Points
            </Chip>
          </ChipRow>
          <ChipRow>
            <Chip $active={season === ALL_SEASONS} onClick={() => setSeason(ALL_SEASONS)}>
              All time
            </Chip>
            {SEASONS.map(s => (
              <Chip
                key={s.id}
                $active={season === String(s.id)}
                onClick={() => setSeason(String(s.id))}>
                {s.name}
              </Chip>
            ))}
          </ChipRow>
          <RatingChart
            runs={runs}
            metric={metric}
            showBoundaries={season === ALL_SEASONS}
            // Divisions are defined on points, and their bounds differ between solo
            // and team modes.
            bands={metric === 'points' ? divisionBands(mode.key === '1v1', currentBonusPool()) : []}
          />
        </CardBody>
      ) : undefined}
    </ModeCard>
  )
}

function RatingChart({
  runs,
  metric,
  showBoundaries,
  bands,
}: {
  runs: RatingPoint[][]
  metric: Metric
  showBoundaries: boolean
  bands: DivisionBand[]
}) {
  const all = runs.flat()
  const values = all.map(p => (metric === 'points' ? p.points : p.rating))
  const lo = metric === 'points' ? 0 : Math.floor((Math.min(...values) - 40) / 50) * 50
  const hi = Math.ceil((Math.max(...values) + 60) / 50) * 50

  return (
    <ChartArea>
      <ResponsiveContainer width='100%' height='100%'>
        <LineChart margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          {/* Bands first, so the grid and the series draw over them. */}
          {bands
            .filter(b => b.low < hi && b.high > lo)
            .map(b => (
              <ReferenceArea
                key={b.division}
                y1={Math.max(lo, b.low)}
                y2={Math.min(hi, b.high)}
                fill={b.color}
                fillOpacity={b.opacity}
                stroke='none'
                ifOverflow='hidden'
              />
            ))}
          <CartesianGrid stroke='var(--theme-outline-variant)' vertical={false} />
          <XAxis
            dataKey='game'
            type='number'
            domain={[all[0].game, all[all.length - 1].game]}
            stroke='var(--theme-on-surface-variant)'
            tick={{ fontSize: 12 }}
            tickLine={false}
          />
          <YAxis
            domain={[lo, hi]}
            stroke='var(--theme-on-surface-variant)'
            tick={{ fontSize: 12 }}
            tickLine={false}
            width={52}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--theme-container-high)',
              border: '1px solid var(--theme-outline-variant)',
              borderRadius: '6px',
            }}
            labelFormatter={value => `Game ${String(value)}`}
            formatter={value => [
              Math.round(Number(value)),
              metric === 'points' ? 'Points' : 'Rating',
            ]}
          />
          {showBoundaries
            ? SEASONS.slice(1).map(s => (
                <ReferenceLine
                  key={s.id}
                  x={s.start}
                  stroke='var(--theme-outline)'
                  strokeDasharray='4 4'
                />
              ))
            : undefined}
          {/* One Line per run, so the series never connects across a reset. */}
          {runs.map((run, i) => (
            <Line
              key={i}
              data={run}
              dataKey={metric}
              type='monotone'
              stroke={metric === 'points' ? 'var(--theme-color-zerg)' : 'var(--theme-color-terran)'}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartArea>
  )
}

// --- Rivals ---------------------------------------------------------------

const RivalsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
`

const RivalPanel = styled.div`
  background: var(--theme-container-low);
  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
  padding: 14px 16px;
`

const PanelTitle = styled.div`
  ${titleSmall};
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
`

const PanelNote = styled.span`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
`

const PlayerRow = styled.a`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  margin: 0 -8px;
  border-radius: 6px;
  color: inherit;
  text-decoration: none;

  &:hover {
    background: var(--theme-container);
  }
`

const Avatar = styled.div<{ $color: string }>`
  width: 26px;
  height: 26px;
  border-radius: 50%;
  flex-shrink: 0;
  display: grid;
  place-items: center;

  ${labelMedium};
  background: ${props => props.$color};
  color: var(--theme-surface);
`

const PlayerName = styled.div`
  ${bodyMedium};
  ${singleLine};
  flex-grow: 1;
`

const PlayerStat = styled.div`
  text-align: right;
  flex-shrink: 0;
`

const TONE_COLORS = {
  positive: 'var(--theme-positive)',
  negative: 'var(--theme-negative)',
} as const

const StatMain = styled.div<{ $tone?: keyof typeof TONE_COLORS }>`
  ${bodyMedium};
  font-variant-numeric: tabular-nums;
  color: ${props => (props.$tone ? TONE_COLORS[props.$tone] : 'inherit')};
`

const StatSub = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const AVATAR_COLORS = [
  'var(--theme-color-terran)',
  'var(--theme-color-protoss)',
  'var(--theme-color-zerg)',
  'var(--theme-positive)',
  'var(--theme-color-random)',
  'var(--theme-amber)',
]

function RivalsSection() {
  return (
    <RivalsGrid>
      <RivalList title='Best allies' note='min. 10 games together' entries={BEST_ALLIES} showRate />
      <RivalList title='Rivals' note='most games played against' entries={RIVALS} />
      <RivalList
        title='Toughest opponents'
        note='min. 10 games against'
        entries={TOUGHEST_OPPONENTS}
        showRate
      />
    </RivalsGrid>
  )
}

function RivalList({
  title,
  note,
  entries,
  showRate,
}: {
  title: string
  note: string
  entries: ReadonlyArray<RivalEntry>
  showRate?: boolean
}) {
  return (
    <RivalPanel>
      <PanelTitle>
        {title}
        <PanelNote>{note}</PanelNote>
      </PanelTitle>
      {entries.map(entry => {
        const rate = Math.round((entry.wins / entry.games) * 100)
        const losses = entry.games - entry.wins
        return (
          <PlayerRow
            key={`${title}-${entry.userId}`}
            href={`/users/${entry.userId}/${entry.name}`}
            title={`Go to ${entry.name}'s profile`}>
            <Avatar $color={AVATAR_COLORS[entry.userId % AVATAR_COLORS.length]}>
              {entry.name.charAt(0)}
            </Avatar>
            <PlayerName>{entry.name}</PlayerName>
            <PlayerStat>
              {showRate ? (
                <>
                  <StatMain $tone={rate >= 50 ? 'positive' : 'negative'}>{rate}%</StatMain>
                  <StatSub>
                    {entry.wins}–{losses} · {entry.games} games
                  </StatSub>
                </>
              ) : (
                <>
                  <StatMain>
                    {entry.wins}–{losses}
                  </StatMain>
                  <StatSub>
                    {rate}% · {entry.games} games
                  </StatSub>
                </>
              )}
            </PlayerStat>
          </PlayerRow>
        )
      })}
    </RivalPanel>
  )
}

// --- Matchups -------------------------------------------------------------

const Filters = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 16px;
`

/**
 * Selects are `width: 100%` of whatever contains them, and their dropdown arrow is
 * absolutely positioned over the right edge. Without a width they collapse to fit a
 * flex line and the value runs underneath the arrow, so give them one. Map values
 * carry a win rate suffix and need the extra room.
 */
const Filter = styled.div<{ $wide?: boolean }>`
  width: ${props => (props.$wide ? '288px' : '208px')};
  max-width: 100%;
`

const Coverage = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
  margin-bottom: 10px;
  font-variant-numeric: tabular-nums;
`

const MatrixScroll = styled.div`
  overflow-x: auto;
`

const Matrix = styled.table`
  border-collapse: separate;
  border-spacing: 4px;
  margin: 0 -4px;
`

const Corner = styled.th`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
  text-align: left;
  width: 54px;
  white-space: nowrap;
`

const ColHead = styled.th`
  ${titleSmall};
  padding: 4px 5px;
  text-align: center;
`

const RowHead = styled.th`
  ${titleSmall};
  padding: 5px 7px;
  text-align: right;
`

const Cell = styled.td<{ $tint: string; $thin: boolean; $empty: boolean }>`
  box-sizing: border-box;
  min-width: 62px;
  padding: 7px 5px;
  border-radius: 6px;
  text-align: center;
  background: ${props => props.$tint};
  opacity: ${props => (props.$thin ? 0.55 : 1)};
`

const CellRate = styled.div<{ $empty: boolean }>`
  ${titleSmall};
  font-variant-numeric: tabular-nums;
  color: ${props => (props.$empty ? 'var(--theme-on-surface-variant)' : 'inherit')};
`

const CellRecord = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
  min-height: 1.3em;
`

const RaceChip = styled.span<{ $race: AssignedRaceChar }>`
  color: ${props => getRaceColor(props.$race)};
`

const Combo = styled.span`
  display: inline-flex;
  gap: 2px;
`

const RACE_LABELS: Record<AssignedRaceChar, string> = {
  t: 'Terran',
  p: 'Protoss',
  z: 'Zerg',
}

function ComboLabel({ parts }: { parts: AssignedRaceChar[] }) {
  if (parts.length === 1) {
    return <RaceChip $race={parts[0]}>{RACE_LABELS[parts[0]]}</RaceChip>
  }
  return (
    <Combo>
      {parts.map((race, i) => (
        <RaceChip key={i} $race={race}>
          {race.toUpperCase()}
        </RaceChip>
      ))}
    </Combo>
  )
}

function tintFor(cell: MatchupCell): string {
  if (!cell.games) return 'var(--theme-container)'
  const rate = cell.wins / cell.games
  const d = Math.max(-0.28, Math.min(0.28, rate - 0.5))
  const alpha = ((Math.abs(d) / 0.28) * 0.3).toFixed(3)
  return d >= 0 ? `rgba(105, 240, 174, ${alpha})` : `rgba(230, 96, 96, ${alpha})`
}

function MatchupsSection() {
  const [mode, setMode] = useState<string>(ALL_MODES)
  const [season, setSeason] = useState<string>(ALL_SEASONS)
  const [map, setMap] = useState<string>(ALL_MAPS)

  const availableMaps = mapsFor(mode, season)
    .map(name => ({ name, stats: mapStats(mode, season, name) }))
    .sort((a, b) => {
      const rateA = a.stats.games ? a.stats.wins / a.stats.games : 0
      const rateB = b.stats.games ? b.stats.wins / b.stats.games : 0
      return rateB - rateA || b.stats.games - a.stats.games
    })
  // A map selection may not exist in a new mode/season pool.
  const activeMap = availableMaps.some(m => m.name === map) ? map : ALL_MAPS

  const combos = raceCombos(teamSizeFor(mode))
  const isTeam = teamSizeFor(mode) > 1

  let played = 0
  let thin = 0
  let best = 0
  for (const row of combos) {
    for (const col of combos) {
      const cell = matchupCell(mode, season, activeMap, row, col)
      if (cell.games) played++
      if (cell.games && cell.games < 5) thin++
      if (cell.games > best) best = cell.games
    }
  }
  const total = combos.length * combos.length

  return (
    <div>
      <Filters>
        <Filter>
          <Select
            value={mode}
            label='Game mode'
            onChange={(value: string) => {
              setMode(value)
              setMap(ALL_MAPS)
            }}>
            <SelectOption value={ALL_MODES} text='Overall' />
            {MODES_BY_PLAYTIME.map(m => (
              <SelectOption key={m.key} value={m.key} text={m.label.replace(/^Ranked /, '')} />
            ))}
          </Select>
        </Filter>
        <Filter>
          <Select
            value={season}
            label='Season'
            onChange={(value: string) => {
              setSeason(value)
              setMap(ALL_MAPS)
            }}>
            <SelectOption value={ALL_SEASONS} text='Overall' />
            {SEASONS.map(s => (
              <SelectOption key={s.id} value={String(s.id)} text={s.name} />
            ))}
          </Select>
        </Filter>
        <Filter $wide={true}>
          <Select value={activeMap} label='Map' onChange={(value: string) => setMap(value)}>
            <SelectOption value={ALL_MAPS} text='Overall' />
            {availableMaps.map(m => (
              <SelectOption
                key={m.name}
                value={m.name}
                text={`${m.name} — ${
                  m.stats.games ? Math.round((m.stats.wins / m.stats.games) * 100) : 0
                }%`}
              />
            ))}
          </Select>
        </Filter>
      </Filters>

      <Coverage>
        {combos.length} × {combos.length} = {total} combinations · {played} played
        {thin ? ` · ${thin} under 5 games` : ''} · best-sampled cell {best} games
      </Coverage>

      <MatrixScroll>
        <Matrix>
          <thead>
            <tr>
              <Corner>
                <div>{isTeam ? 'team ↓' : 'you ↓'}</div>
                <div>{isTeam ? 'opp →' : 'them →'}</div>
              </Corner>
              {combos.map(col => (
                <ColHead key={col.join('')}>
                  <ComboLabel parts={col} />
                </ColHead>
              ))}
            </tr>
          </thead>
          <tbody>
            {combos.map(row => (
              <tr key={row.join('')}>
                <RowHead>
                  <ComboLabel parts={row} />
                </RowHead>
                {combos.map(col => {
                  const cell = matchupCell(mode, season, activeMap, row, col)
                  const rate = cell.games ? Math.round((cell.wins / cell.games) * 100) : 0
                  return (
                    <Cell
                      key={col.join('')}
                      $tint={tintFor(cell)}
                      $thin={cell.games > 0 && cell.games < 5}
                      $empty={!cell.games}>
                      <CellRate $empty={!cell.games}>{cell.games ? `${rate}%` : '—'}</CellRate>
                      <CellRecord>
                        {cell.games ? `${cell.wins}–${cell.games - cell.wins}` : ''}
                      </CellRecord>
                    </Cell>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </Matrix>
      </MatrixScroll>
    </div>
  )
}

// --- Page -----------------------------------------------------------------

export function StatsPageTest() {
  const [section, setSection] = useState(StatsSection.Rating)

  return (
    <Container>
      <TabsArea>
        <Tabs activeTab={section} onChange={setSection}>
          <TabItem value={StatsSection.Rating} text='Rating' />
          <TabItem value={StatsSection.Rivals} text='Rivals' />
          <TabItem value={StatsSection.Matchups} text='Matchups' />
        </Tabs>
      </TabsArea>

      {section === StatsSection.Rating ? <RatingSection /> : undefined}
      {section === StatsSection.Rivals ? <RivalsSection /> : undefined}
      {section === StatsSection.Matchups ? <MatchupsSection /> : undefined}
    </Container>
  )
}
