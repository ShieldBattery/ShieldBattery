import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MATCHMAKING_MODES, MatchmakingType } from '../../common/matchmaking'
import { AssignedRaceChar, raceCharToLabel } from '../../common/races'
import { RaceIcon } from '../lobbies/race-icon'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { labelMedium, labelSmall, titleSmall } from '../styles/typography'
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

const Total = styled.div`
  ${labelMedium};
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

/* Both heads hold icons rather than text now, so they carry no type styles -- the icon's own
   box sets the height and the padding does the rest. */
const ColHead = styled.th`
  padding: 4px 5px;
  text-align: center;
`

const RowHead = styled.th`
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

const Combo = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 2px;
`

/**
 * 20px keeps a team composition's icons inside a header cell that also has to fit the widest
 * matrix a mode can produce; `RaceIcon` colours itself per race, which is what the axes read by.
 */
const ComboIcon = styled(RaceIcon)`
  width: 20px;
  height: 20px;
`

/** Cells with too few games to mean anything are dimmed rather than hidden. */
const THIN_SAMPLE = 5

function ComboLabel({ parts }: { parts: AssignedRaceChar[] }) {
  const { t } = useTranslation()
  return (
    <Combo>
      {parts.map((race, i) => (
        // The label is what a screen reader gets in place of the icon, so it stays the race's
        // real name rather than the single letter the axes used to show.
        <ComboIcon key={i} race={race} ariaLabel={raceCharToLabel(race, t)} />
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

  // The same sum the matrix cells add up to, which is why it's the map stats rather than a
  // separate walk: whatever the filters are showing, this is its record.
  const total = source.mapStats(mode, season, activeMap)

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

      {/* The record for whatever the filters are showing. Under the current season it equals
          the card's own header, which is what makes the two legible together: the header is
          current-season, this follows the filter. */}
      <Total>
        {t('users.profile.stats.matchupTotal', {
          defaultValue: 'Total: {{wins}}–{{losses}}',
          wins: total.wins,
          losses: total.games - total.wins,
        })}
      </Total>

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
