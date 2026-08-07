import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { MATCHMAKING_MODES, MatchmakingType, TEAM_SIZES } from '../../common/matchmaking'
import { AssignedRaceChar, raceCharToLabel } from '../../common/races'
import { MaterialIcon } from '../icons/material/material-icon'
import { RaceIcon } from '../lobbies/race-icon'
import { buttonReset } from '../material/button-reset'
import { RangeSlider } from '../material/range-slider'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { LoadingDotsArea } from '../progress/dots'
import { bodySmall, labelMedium, labelSmall, titleSmall } from '../styles/typography'
import { MatchupCell, MatchupDataSource, MatchupFilters, raceCombos } from './matchup-data'
import { ALL_MAPS, ALL_SEASONS } from './stats-filters'

/**
 * What the matrix has to show. Kept as one value rather than separate `fetching`/`error` flags so
 * the states can't contradict each other, and so a caller with data already in hand (the dev
 * page) just passes `ready`.
 */
export type MatchupMatrixState = 'loading' | 'error' | 'ready'

/** Whose games the matrix is showing. */
export type MatchupScope = 'mine' | 'global'

/** The band grid the rating filter lays itself out on, as the query reports it. */
export interface RatingBands {
  size: number
  min: number
  max: number
}

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
  align-items: flex-end;
  gap: 16px;
  margin-bottom: 16px;
`

/**
 * Wide enough that one 100-point band is at least a thumb across: fifteen bands over 320px leaves
 * ~21px per step against a 20px thumb, so two thumbs at the minimum range sit next to each other
 * rather than on top of each other.
 */
const RatingFilter = styled.div`
  width: 320px;
  max-width: 100%;
`

const ScopeRow = styled.div`
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
`

/**
 * Matches the chip pattern the Stats card's metric switch uses, so the two profile tabs offer the
 * same affordance for "pick one of these".
 */
const ScopeChip = styled.button<{ $active: boolean }>`
  ${buttonReset};
  ${labelMedium};
  padding: 5px 12px;
  border-radius: 999px;

  background: ${props => (props.$active ? 'var(--theme-container-highest)' : 'transparent')};
  border: 1px solid
    ${props => (props.$active ? 'var(--theme-primary)' : 'var(--theme-outline-variant)')};
  color: ${props =>
    props.$active ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)'};
`

const Total = styled.div`
  ${labelMedium};
  margin-bottom: 10px;
  font-variant-numeric: tabular-nums;
`

const Message = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  padding: 8px 0 16px;
`

const MatrixScroll = styled.div`
  overflow-x: auto;
`

/** Uppercase and widely tracked, so it reads as a label on the axis rather than as a heading. */
const axisText = css`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.28em;
  white-space: nowrap;
`

const axisRule = `
  content: '';
  flex: 1;
  background: var(--theme-outline-variant);
`

/**
 * The axis labels live *in* the table rather than in a grid wrapped around it.
 *
 * They have to span the data columns and rows only — a rule reaching over the row heads and the
 * empty corner points at cells that aren't on that axis. Getting that from outside the table would
 * mean re-deriving the head sizes in CSS and keeping the two in step by hand; spanning the cells
 * themselves lets the table do it exactly, at any team size.
 */
const AxisSpacer = styled.th`
  padding: 0;
`

const TopAxisCell = styled.th`
  padding: 0;
  ${axisText};
`

const TopAxisRule = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  /* The tracking adds a trailing space after the last letter; pulling it back keeps the text
     optically centred between the two rules. */
  padding-left: 0.28em;

  &::before,
  &::after {
    ${axisRule};
    height: 1px;
  }
`

/* Positioned rather than flowed: a `height: 100%` child of a row-spanning cell resolves
   inconsistently, and the rules have to reach the full height of the rows to mean anything. */
const LeftAxisCell = styled.th`
  position: relative;
  width: 18px;
  padding: 0;
`

const LeftAxisRule = styled.div`
  position: absolute;
  inset: 0;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;

  &::before,
  &::after {
    ${axisRule};
    width: 1px;
  }
`

/* Reads bottom-to-top, the conventional direction for a y-axis label. `vertical-rl` alone would
   run it top-to-bottom with the glyphs on their side the wrong way. */
const LeftAxisText = styled.div`
  ${axisText};
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  padding-top: 0.28em;
`

const Matrix = styled.table`
  border-collapse: separate;
  border-spacing: 4px;
  margin: 0 -4px;
`

/**
 * The map pool: one card per map, ordered by win rate, each doubling as the map filter.
 *
 * A strip rather than the dropdown it replaced. "Which maps am I good on" is a question the
 * dropdown could technically answer — its options carried the rate as a suffix — but only by
 * opening it and reading a list. Laid out, it answers at a glance, and picking one is the same
 * click it always was.
 *
 * Sits below the matrix rather than up with the other filters. It's a filter, so grouping it with
 * them is the tidier taxonomy — but putting it there pushes the grid a couple of hundred pixels
 * down behind a wall of controls, and the grid is what the tab is for. Below, it reads as the
 * record broken down by map, which is also how it gets used: look at the matrix, notice
 * something, then narrow.
 */
const MapStrip = styled.div`
  margin-top: 24px;
`

const MapStripLabel = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  margin-bottom: 8px;
`

const MapCards = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
`

const MapCard = styled.button<{ $selected: boolean }>`
  ${buttonReset};
  width: 132px;
  padding: 4px 4px 8px;
  border-radius: 8px;
  text-align: left;

  border: 1px solid
    ${props => (props.$selected ? 'var(--theme-amber)' : 'var(--theme-outline-variant)')};
  background: ${props => (props.$selected ? 'var(--theme-container-highest)' : 'transparent')};
  transition:
    border-color 100ms linear,
    background-color 100ms linear;

  &:hover {
    background: var(--theme-container);
  }
`

const MapCardImage = styled.img`
  display: block;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 5px;
  object-fit: cover;
  background-color: var(--theme-container);
`

/** Stands in at the same size when a map's file is gone, so the row doesn't go ragged. */
const MapCardNoImage = styled.div`
  width: 100%;
  aspect-ratio: 1;
  border-radius: 5px;
  background-color: var(--theme-container);
`

/**
 * The tile on the "all maps" card. Marked with an icon rather than left blank so it doesn't read
 * as a map whose preview failed to load — the one thing the blank tile already means.
 */
const MapCardAllTile = styled(MapCardNoImage)`
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--theme-on-surface-variant);
`

const MapCardName = styled.div`
  ${labelMedium};
  margin-top: 6px;
  padding: 0 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const MapCardRecord = styled.div`
  ${labelSmall};
  padding: 0 2px;
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const MapCardRate = styled.span<{ $positive: boolean }>`
  color: ${props => (props.$positive ? 'var(--theme-positive)' : 'var(--theme-negative)')};
`

/**
 * Empty: it sits above the row heads only to hold the column open, and the axes read from the
 * race icons themselves. Its width comes from the row heads below it, which is why a team mode's
 * wider composition doesn't need a different value here.
 */
const Corner = styled.th``

/* Both heads hold icons and no text, so they carry no type styles -- the icon's own box sets the
   height and the padding does the rest.

   `$active` is the crosshair: hovering a cell lights up the two heads that name it. A 10x10 grid
   is far enough from its own axes that tracing a cell back by eye is genuinely error-prone, and
   icon heads leave counting rows as the only fallback. Background rather than a border, so
   nothing reflows as the highlight moves. */
const HeadHighlight = `
  background: var(--theme-container-highest);
  border-radius: 4px;
`

const ColHead = styled.th<{ $active: boolean }>`
  padding: 4px 5px;
  text-align: center;
  transition: background-color 100ms linear;
  ${props => (props.$active ? HeadHighlight : '')}
`

const RowHead = styled.th<{ $active: boolean }>`
  padding: 5px 7px;
  text-align: right;
  transition: background-color 100ms linear;
  ${props => (props.$active ? HeadHighlight : '')}
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

/**
 * A map's preview, falling back to the placeholder box.
 *
 * The fallback covers two different things that look the same to a reader: a map with no file at
 * all (no URL to try), and a URL whose image doesn't load. The second is the one worth handling
 * explicitly — an image the browser can't fetch otherwise renders as a broken-image glyph, which
 * reads as a bug rather than as a missing preview.
 */
function MapPreview({ url, name }: { url?: string; name: string }) {
  const [failed, setFailed] = useState(false)
  if (!url || failed) {
    return <MapCardNoImage />
  }
  return (
    <MapCardImage src={url} alt='' title={name} loading='lazy' onError={() => setFailed(true)} />
  )
}

function ComboLabel({ parts }: { parts: AssignedRaceChar[] }) {
  const { t } = useTranslation()
  return (
    <Combo>
      {parts.map((race, i) => (
        // The icons carry no text, so this label is the whole of what a screen reader gets for
        // an axis -- hence the race's full name rather than anything abbreviated.
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
 *
 * Takes its buckets as a source rather than fetching them, so the dev page can drive the real
 * component from fixtures. The mode is a prop rather than local state for the opposite reason:
 * a mode is a different set of buckets, so only the caller that fetches them can change it.
 */
export function MatchupMatrix({
  source,
  state,
  mode,
  modes,
  onModeChange,
  scope,
  onScopeChange,
  seasons,
  ratingBands,
}: {
  source: MatchupDataSource
  state: MatchupMatrixState
  /** The mode the source holds. Decides the size of the axes, so it can't be filtered locally. */
  mode: MatchmakingType
  /** Modes to offer, in the order they should appear. */
  modes: ReadonlyArray<MatchmakingType>
  onModeChange: (mode: MatchmakingType) => void
  /** Whose games the source holds. Like the mode, a different fetch rather than a local filter. */
  scope: MatchupScope
  onScopeChange: (scope: MatchupScope) => void
  /** Seasons to offer, newest first. */
  seasons: ReadonlyArray<{ id: number; name: string }>
  ratingBands: RatingBands
}) {
  const { t } = useTranslation()
  const mapStripId = useId()
  const [season, setSeason] = useState<string>(ALL_SEASONS)
  const [map, setMap] = useState<string>(ALL_MAPS)
  const [ratingRange, setRatingRange] = useState<[number, number]>([
    ratingBands.min,
    ratingBands.max,
  ])
  // Which cell the pointer is over, so its two axis heads can be highlighted.
  const [hovered, setHovered] = useState<{ row: string; col: string }>()

  // The seasons on offer are the ones the *loaded* scope was played in, so a season only the
  // ladder saw would survive a switch to "my matchups" as an id with no option behind it: a blank
  // dropdown over an empty grid, and no message to explain it, since a season selection means the
  // filters aren't wide open. The same reason the mode picker resets it. `map` needs no reset --
  // the `activeMap` fallback below already covers a selection the new pool doesn't have.
  const changeScope = (next: MatchupScope) => {
    if (next === scope) return
    onScopeChange(next)
    setSeason(ALL_SEASONS)
  }

  // Clamped rather than trusted, since the band grid comes from the payload and a mode with a
  // different one would otherwise leave the thumbs outside the track. The high end is also held a
  // band above the low one, matching the slider's own `minRange`, so a stale selection can't put
  // the thumbs somewhere the slider itself would never let them go.
  const low = Math.max(
    ratingBands.min,
    Math.min(ratingBands.max - ratingBands.size, ratingRange[0]),
  )
  const range: [number, number] = [
    low,
    Math.max(low + ratingBands.size, Math.min(ratingBands.max, ratingRange[1])),
  ]
  const filters: MatchupFilters = { season, map, ratingRange: range }

  const availableMaps = source
    .maps(filters)
    .map(info => ({ ...info, stats: source.mapStats({ ...filters, map: info.name }) }))
    .sort((a, b) => {
      // Best first for a player's own maps. Globally every map's rate is 50% by construction
      // (see `showsRecord`), so ordering by it would be ordering by noise -- most played first
      // is the one thing that does vary and does say something.
      if (scope === 'global') {
        return b.stats.games - a.stats.games || a.name.localeCompare(b.name)
      }
      const rateA = a.stats.games ? a.stats.wins / a.stats.games : 0
      const rateB = b.stats.games ? b.stats.wins / b.stats.games : 0
      return rateB - rateA || b.stats.games - a.stats.games
    })
  // A map selection may not exist in a new mode/season pool.
  const activeMap = availableMaps.some(m => m.name === map) ? map : ALL_MAPS
  const active: MatchupFilters = { ...filters, map: activeMap }

  const teamSize = TEAM_SIZES[mode]
  const combos = raceCombos(teamSize)
  const isTeam = teamSize > 1
  // The axis labels name the viewed player's side against their opponents', which only the
  // per-player matrix has. They add two cells to the table, so the layout reads this too.
  const axes = scope === 'mine'

  // The same sum the matrix cells add up to, which is why it's the map stats rather than a
  // separate walk: whatever the filters are showing, this is its record.
  const total = source.mapStats(active)
  // Across every map, for the "all maps" card. Same figure as `total` whenever no map is
  // selected, which is exactly when that card is the selected one.
  const overall = source.mapStats({ ...filters, map: ALL_MAPS })
  const overallRate = overall.games ? Math.round((overall.wins / overall.games) * 100) : 0

  // A per-map win rate is only a fact about somebody. The global matrix counts every game once
  // from each side, so summing a map's cells necessarily gives one win and one loss per game --
  // a rate pinned at 50% by arithmetic, not a measurement of the map. The cells themselves stay
  // meaningful (PvZ and ZvP are different cells); it's only the totals over a whole map that
  // collapse. So the cards carry names alone in the global scope.
  const showsRecord = scope === 'mine'

  // That same double counting makes the bucket sum a count of sides rather than of games: two per
  // game in every mode, since a side is counted once however many players stood on it. Dividing is
  // what turns it back into games. The record can't be rescued the same way -- halving both halves
  // of a 50% split still leaves 50%.
  const totalGames = showsRecord ? total.games : Math.round(total.games / 2)

  // The top and bottom bands are clamped, so they stand for everything past their edge rather
  // than for one 200-point slice; the labels say so instead of implying a hard cut.
  const formatBand = (value: number) => {
    if (value <= ratingBands.min) return `≤${ratingBands.min}`
    if (value >= ratingBands.max) return `${ratingBands.max}+`
    return String(value)
  }

  // The filters stay mounted through every state, the mode picker included: a mode with nothing
  // to show is exactly when a player wants to switch to one that has.
  let body: React.ReactNode
  if (state === 'loading') {
    body = <LoadingDotsArea />
  } else if (state === 'error') {
    body = (
      <Message>
        {t('users.profile.matchups.loadError', 'There was a problem loading matchups.')}
      </Message>
    )
  } else if (!total.games && isUnfiltered(active, ratingBands)) {
    body = (
      <Message>
        {scope === 'global'
          ? t('users.profile.matchups.noGlobalGames', 'No ranked games in this mode yet.')
          : t('users.profile.matchups.noGames', 'No games with a recorded matchup yet.')}
      </Message>
    )
  } else {
    body = (
      <>
        {/* The sum of every cell below, for whatever the filters are showing. A record where
            that's a record of somebody; a game count in the global scope, where a win-loss
            summed over the whole matrix is 50-50 for the same reason the map cards drop theirs. */}
        <Total>
          {showsRecord
            ? t('users.profile.matchups.total', {
                defaultValue: 'Total: {{wins}}–{{losses}}',
                wins: total.wins,
                losses: total.games - total.wins,
              })
            : t('users.profile.matchups.totalGames', {
                defaultValue: 'Total: {{count}} games',
                count: totalGames,
              })}
        </Total>

        <MatrixScroll>
          {/* Clearing on leave rather than per-cell, so moving between two cells doesn't blink
              the highlight off in the gap between them. */}
          <Matrix onMouseLeave={() => setHovered(undefined)}>
            <thead>
              {/* Only for a player's own matrix. "Me" has no referent in the global one, where
                    every game is counted from both sides at once. */}
              {axes ? (
                <tr aria-hidden={true}>
                  {/* Holds open the label column and the corner, so the rule starts at the
                        first data column rather than over the row heads. */}
                  <AxisSpacer colSpan={2} />
                  <TopAxisCell colSpan={combos.length}>
                    <TopAxisRule>
                      {isTeam
                        ? t('users.profile.matchups.axisOpponentTeam', 'opponent team')
                        : t('users.profile.matchups.axisOpponent', 'opponent')}
                    </TopAxisRule>
                  </TopAxisCell>
                </tr>
              ) : undefined}
              <tr>
                {axes ? <AxisSpacer /> : undefined}
                <Corner />
                {combos.map(col => (
                  <ColHead key={col.join('')} $active={hovered?.col === col.join('')}>
                    <ComboLabel parts={col} />
                  </ColHead>
                ))}
              </tr>
            </thead>
            <tbody>
              {combos.map((row, rowIndex) => (
                <tr key={row.join('')}>
                  {/* Spans every data row, so the rule stops short of the column heads. */}
                  {axes && rowIndex === 0 ? (
                    <LeftAxisCell rowSpan={combos.length} aria-hidden={true}>
                      <LeftAxisRule>
                        <LeftAxisText>
                          {isTeam
                            ? t('users.profile.matchups.axisMyTeam', 'my team')
                            : t('users.profile.matchups.axisMe', 'me')}
                        </LeftAxisText>
                      </LeftAxisRule>
                    </LeftAxisCell>
                  ) : undefined}
                  <RowHead $active={hovered?.row === row.join('')}>
                    <ComboLabel parts={row} />
                  </RowHead>
                  {combos.map(col => {
                    const cell = source.cell(active, row, col)
                    const rate = cell.games ? Math.round((cell.wins / cell.games) * 100) : 0
                    return (
                      <Cell
                        key={col.join('')}
                        $tint={tintFor(cell)}
                        $thin={cell.games > 0 && cell.games < THIN_SAMPLE}
                        onMouseEnter={() => setHovered({ row: row.join(''), col: col.join('') })}>
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

        {/* Hidden only when the pool is genuinely empty -- a heading over nothing is worse than
            no heading. Every other filter narrowing to zero still leaves the strip in place. */}
        {availableMaps.length ? (
          <MapStrip>
            <MapStripLabel id={mapStripId}>{t('users.profile.matchups.map', 'Map')}</MapStripLabel>
            {/* A radio group, not a set of toggles: exactly one option is always chosen, and
                "every map" is one of the options rather than something you get back to by
                clicking the current selection off. That route existed and worked, but nothing
                on screen said so. */}
            <MapCards role='radiogroup' aria-labelledby={mapStripId}>
              <MapCard
                role='radio'
                $selected={activeMap === ALL_MAPS}
                aria-checked={activeMap === ALL_MAPS}
                onClick={() => setMap(ALL_MAPS)}>
                <MapCardAllTile>
                  <MaterialIcon icon='grid_view' size={36} />
                </MapCardAllTile>
                <MapCardName>{t('users.profile.matchups.allMaps', 'All maps')}</MapCardName>
                {showsRecord ? (
                  <MapCardRecord>
                    <MapCardRate $positive={overallRate >= 50}>{overallRate}%</MapCardRate>
                    {' · '}
                    {overall.wins}&ndash;{overall.games - overall.wins}
                  </MapCardRecord>
                ) : undefined}
              </MapCard>
              {availableMaps.map(m => {
                const selected = activeMap === m.name
                const rate = m.stats.games ? Math.round((m.stats.wins / m.stats.games) * 100) : 0
                return (
                  <MapCard
                    key={m.name}
                    role='radio'
                    $selected={selected}
                    aria-checked={selected}
                    onClick={() => setMap(m.name)}>
                    <MapPreview url={m.imageUrl} name={m.name} />
                    <MapCardName title={m.name}>{m.name}</MapCardName>
                    {showsRecord ? (
                      <MapCardRecord>
                        <MapCardRate $positive={rate >= 50}>{rate}%</MapCardRate>
                        {' · '}
                        {m.stats.wins}&ndash;{m.stats.games - m.stats.wins}
                      </MapCardRecord>
                    ) : undefined}
                  </MapCard>
                )
              })}
            </MapCards>
          </MapStrip>
        ) : undefined}
      </>
    )
  }

  return (
    <div>
      <ScopeRow role='group' aria-label={t('users.profile.matchups.scope', 'Matchups shown')}>
        <ScopeChip
          $active={scope === 'mine'}
          aria-pressed={scope === 'mine'}
          onClick={() => changeScope('mine')}>
          {t('users.profile.matchups.scopeMine', 'My matchups')}
        </ScopeChip>
        <ScopeChip
          $active={scope === 'global'}
          aria-pressed={scope === 'global'}
          onClick={() => changeScope('global')}>
          {t('users.profile.matchups.scopeGlobal', 'Global')}
        </ScopeChip>
      </ScopeRow>

      <Filters>
        {/* Hidden when there's only one mode to pick: a dropdown offering one real choice is
            just noise. */}
        {modes.length > 1 ? (
          <Filter>
            <Select
              value={mode}
              label={t('users.profile.matchups.gameMode', 'Game mode')}
              allowErrors={false}
              onChange={(value: MatchmakingType) => {
                onModeChange(value)
                // Neither selection is guaranteed to exist in the new mode's pool, and a season
                // or map silently reinterpreted against different data reads as a bug.
                setSeason(ALL_SEASONS)
                setMap(ALL_MAPS)
              }}>
              {modes.map(type => (
                <SelectOption key={type} value={type} text={MATCHMAKING_MODES[type].label(t)} />
              ))}
            </Select>
          </Filter>
        ) : undefined}
        <Filter>
          <Select
            value={season}
            label={t('users.profile.matchups.season', 'Season')}
            allowErrors={false}
            onChange={(value: string) => {
              setSeason(value)
              setMap(ALL_MAPS)
            }}>
            <SelectOption
              value={ALL_SEASONS}
              text={t('users.profile.matchups.overall', 'Overall')}
            />
            {seasons.map(s => (
              <SelectOption key={s.id} value={String(s.id)} text={s.name} />
            ))}
          </Select>
        </Filter>
        <RatingFilter>
          <RangeSlider
            min={ratingBands.min}
            max={ratingBands.max}
            step={ratingBands.size}
            // A zero-width window would stack the thumbs and blank the filled track, which reads
            // as a broken control rather than as one band selected.
            minRange={ratingBands.size}
            value={range}
            onChange={setRatingRange}
            label={t('users.profile.matchups.rating', 'Rating')}
            lowLabel={t('users.profile.matchups.ratingMin', 'minimum')}
            highLabel={t('users.profile.matchups.ratingMax', 'maximum')}
            formatValue={formatBand}
          />
        </RatingFilter>
      </Filters>

      {body}
    </div>
  )
}

/** Whether the filters are wide open, which is what separates "no games" from "none in range". */
function isUnfiltered(filters: MatchupFilters, bands: RatingBands): boolean {
  return (
    filters.season === ALL_SEASONS &&
    filters.map === ALL_MAPS &&
    filters.ratingRange[0] <= bands.min &&
    filters.ratingRange[1] >= bands.max
  )
}
