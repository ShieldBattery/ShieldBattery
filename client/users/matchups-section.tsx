import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MATCHMAKING_MODES, MatchmakingType } from '../../common/matchmaking'
import { AssignedRaceChar, raceCharToLabel } from '../../common/races'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { getRaceColor } from '../styles/colors'
import { labelSmall, titleSmall } from '../styles/typography'
import { MatchupCell, MatchupDataSource, ModeFilter, raceCombos, teamSizeFor } from './matchup-data'
import { ALL_MAPS, ALL_MODES, ALL_SEASONS } from './stats-filters'

/**
 * Selects are `width: 100%` of whatever contains them, and their dropdown arrow is
 * absolutely positioned over the right edge. Without a width they collapse to fit a flex
 * line and the value runs underneath the arrow, so give them one. Map values carry a win
 * rate suffix and need the extra room.
 */
const Filter = styled.div<{ $wide?: boolean }>`
  width: ${props => (props.$wide ? '288px' : '208px')};
  max-width: 100%;
`

const Filters = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 16px;
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

const Cell = styled.td<{ $tint: string; $thin: boolean }>`
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

/** Cells with too few games to mean anything are dimmed rather than hidden. */
const THIN_SAMPLE = 5

function ComboLabel({ parts }: { parts: AssignedRaceChar[] }) {
  const { t } = useTranslation()
  if (parts.length === 1) {
    return <RaceChip $race={parts[0]}>{raceCharToLabel(parts[0], t)}</RaceChip>
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

/**
 * Win rate as a wash of colour behind the cell. Capped at +/-28 points either side of
 * even, so one lopsided cell out of a handful of games doesn't flatten the shading
 * everywhere else.
 */
function tintFor(cell: MatchupCell): string {
  if (!cell.games) return 'var(--theme-container)'
  const rate = cell.wins / cell.games
  const d = Math.max(-0.28, Math.min(0.28, rate - 0.5))
  const alpha = ((Math.abs(d) / 0.28) * 0.3).toFixed(3)
  return d >= 0
    ? `rgb(from var(--theme-positive) r g b / ${alpha})`
    : `rgb(from var(--theme-negative) r g b / ${alpha})`
}

/**
 * The player's record by race composition, their team's against the opposing team's.
 *
 * Compositions are unordered, so a team mode collapses to 6x6 (2v2) or 10x10 (3v3) rather
 * than every permutation. Even so the matrix is mostly sparse for team modes -- that's
 * the honest picture, which is why empty cells are shown as blanks rather than dropped.
 */
export function MatchupsSection({
  source,
  modes,
  seasons,
}: {
  source: MatchupDataSource
  /** Modes to offer, in the order they should appear. */
  modes: ReadonlyArray<MatchmakingType>
  /** Seasons to offer, newest first. */
  seasons: ReadonlyArray<{ id: number; name: string }>
}) {
  const { t } = useTranslation()
  // With a single mode there's nothing to combine, so start on it rather than on the combined
  // view -- otherwise `teamSizeFor(ALL_MODES)` would decide the axes instead of the mode itself.
  const [mode, setMode] = useState<ModeFilter>(modes.length === 1 ? modes[0] : ALL_MODES)
  const [season, setSeason] = useState<string>(ALL_SEASONS)
  const [map, setMap] = useState<string>(ALL_MAPS)

  const availableMaps = source
    .maps(mode, season)
    .map(name => ({ name, stats: source.mapStats(mode, season, name) }))
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
      const cell = source.cell(mode, season, activeMap, row, col)
      if (cell.games) played++
      if (cell.games && cell.games < THIN_SAMPLE) thin++
      if (cell.games > best) best = cell.games
    }
  }

  return (
    <div>
      <Filters>
        {/* Hidden when there's only one mode to pick: the caller has already established which
            mode this matrix is for, and a dropdown offering one real choice is just noise. */}
        {modes.length > 1 ? (
          <Filter>
            <Select
              value={mode}
              label={t('users.profile.stats.gameMode', 'Game mode')}
              allowErrors={false}
              onChange={(value: ModeFilter) => {
                setMode(value)
                setMap(ALL_MAPS)
              }}>
              <SelectOption value={ALL_MODES} text={t('users.profile.stats.overall', 'Overall')} />
              {modes.map(type => (
                <SelectOption key={type} value={type} text={MATCHMAKING_MODES[type].label(t)} />
              ))}
            </Select>
          </Filter>
        ) : undefined}
        <Filter>
          <Select
            value={season}
            label={t('users.profile.stats.season', 'Season')}
            allowErrors={false}
            onChange={(value: string) => {
              setSeason(value)
              setMap(ALL_MAPS)
            }}>
            <SelectOption value={ALL_SEASONS} text={t('users.profile.stats.overall', 'Overall')} />
            {seasons.map(s => (
              <SelectOption key={s.id} value={String(s.id)} text={s.name} />
            ))}
          </Select>
        </Filter>
        <Filter $wide={true}>
          <Select
            value={activeMap}
            label={t('users.profile.stats.map', 'Map')}
            allowErrors={false}
            onChange={(value: string) => setMap(value)}>
            <SelectOption value={ALL_MAPS} text={t('users.profile.stats.overall', 'Overall')} />
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
        {t('users.profile.stats.matrixCoverage', {
          defaultValue: '{{total}} combinations · {{played}} played · best cell {{best}} games',
          total: combos.length * combos.length,
          played,
          best,
        })}
        {thin
          ? ` · ${t('users.profile.stats.matrixThin', {
              defaultValue: '{{count}} under {{threshold}} games',
              count: thin,
              threshold: THIN_SAMPLE,
            })}`
          : ''}
      </Coverage>

      <MatrixScroll>
        <Matrix>
          <thead>
            <tr>
              <Corner>
                <div>
                  {isTeam
                    ? t('users.profile.stats.axisTeam', 'team ↓')
                    : t('users.profile.stats.axisYou', 'you ↓')}
                </div>
                <div>
                  {isTeam
                    ? t('users.profile.stats.axisOpp', 'opp →')
                    : t('users.profile.stats.axisThem', 'them →')}
                </div>
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
                  const cell = source.cell(mode, season, activeMap, row, col)
                  const rate = cell.games ? Math.round((cell.wins / cell.games) * 100) : 0
                  return (
                    <Cell
                      key={col.join('')}
                      $tint={tintFor(cell)}
                      $thin={cell.games > 0 && cell.games < THIN_SAMPLE}>
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
