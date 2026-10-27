import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { AssignedRaceChar } from '../../common/races'
import { numberFormat, useFormat } from '../i18n/locale-formats'
import { headlineLarge, labelMedium, labelSmall, titleLarge } from '../styles/typography'
import { MatchupCell, MatchupDataSource, MatchupFilters } from './matchup-data'
import type { MatchupScope } from './matchup-matrix'
import { ComboLabel } from './race-combo-label'

/** Small, uppercase and tracked, for the labels that name a section or a summary figure. */
export const sectionLabel = css`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.14em;
`

/** Styled like the Stats tab's mode cards, so the headline figures sit in the same kind of box. */
const Summary = styled.div`
  width: fit-content;
  max-width: 100%;
  display: flex;
  flex-wrap: wrap;
  gap: 16px 40px;
  margin-bottom: 20px;
  padding: 16px 20px;

  background: var(--theme-container-low);
  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
`

const SummaryItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const SummaryLabel = styled.div`
  ${sectionLabel};
`

const TONE_COLORS = {
  positive: 'var(--theme-positive)',
  negative: 'var(--theme-negative)',
  neutral: 'var(--theme-on-surface)',
}

const SummaryFigure = styled.div<{ $tone?: keyof typeof TONE_COLORS }>`
  ${headlineLarge};
  font-variant-numeric: tabular-nums;
  color: ${props => TONE_COLORS[props.$tone ?? 'neutral']};
`

/** A matchup's two sides and its rate, set on the figure's baseline so it lines up beside one. */
const SummaryMatchup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
`

const SummaryRate = styled.div<{ $positive: boolean }>`
  ${titleLarge};
  margin-left: 4px;
  font-variant-numeric: tabular-nums;
  color: ${props => (props.$positive ? 'var(--theme-positive)' : 'var(--theme-negative)')};
`

const Versus = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const SummaryDetail = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

/** The fewest games a matchup needs before the summary will call it a best or a toughest. */
const SUMMARY_MIN_GAMES = 20

const countFormat = numberFormat()

interface RatedMatchup {
  races: AssignedRaceChar[]
  opponentRaces: AssignedRaceChar[]
  cell: MatchupCell
}

/**
 * The highest and lowest rated matchups with at least `SUMMARY_MIN_GAMES` behind them, more games
 * winning a tie. Mirror cells are skipped when `skipMirrors` is set, for the global matrix, where
 * their rate is 50% by construction.
 */
export function findExtremes(
  source: MatchupDataSource,
  filters: MatchupFilters,
  combos: AssignedRaceChar[][],
  skipMirrors: boolean,
): { best?: RatedMatchup; worst?: RatedMatchup } {
  let best: RatedMatchup | undefined
  let worst: RatedMatchup | undefined
  const rateOf = (m: RatedMatchup) => m.cell.wins / m.cell.games

  for (const races of combos) {
    for (const opponentRaces of combos) {
      if (skipMirrors && races.join('') === opponentRaces.join('')) continue
      const cell = source.cell(filters, races, opponentRaces)
      if (cell.games < SUMMARY_MIN_GAMES) continue

      const candidate = { races, opponentRaces, cell }
      const rate = rateOf(candidate)
      if (!best || rate > rateOf(best) || (rate === rateOf(best) && cell.games > best.cell.games)) {
        best = candidate
      }
      if (
        !worst ||
        rate < rateOf(worst) ||
        (rate === rateOf(worst) && cell.games > worst.cell.games)
      ) {
        worst = candidate
      }
    }
  }

  // A "best" matchup the player loses more than they win (or the reverse) would be a label
  // contradicting its own number, so each is only reported on the side of even it names.
  return {
    best: best && rateOf(best) > 0.5 ? best : undefined,
    worst: worst && rateOf(worst) < 0.5 ? worst : undefined,
  }
}

function SummaryMatchupItem({ label, matchup }: { label: string; matchup: RatedMatchup }) {
  const { t } = useTranslation()
  const { cell } = matchup
  const rate = Math.round((cell.wins / cell.games) * 100)
  return (
    <SummaryItem>
      <SummaryLabel>{label}</SummaryLabel>
      <SummaryMatchup>
        <ComboLabel parts={matchup.races} />
        <Versus>{t('users.profile.matchups.versus', 'vs')}</Versus>
        <ComboLabel parts={matchup.opponentRaces} />
        <SummaryRate $positive={rate >= 50}>{rate}%</SummaryRate>
      </SummaryMatchup>
      <SummaryDetail>
        {cell.wins}&ndash;{cell.games - cell.wins}
      </SummaryDetail>
    </SummaryItem>
  )
}

/**
 * The figures the matrix adds up to, above it: a player's overall rate and record with their best
 * and toughest matchups, or for the ladder, the number of games and its most one-sided matchup.
 */
export function MatchupSummary({
  scope,
  total,
  extremes,
}: {
  scope: MatchupScope
  total: MatchupCell
  extremes: { best?: RatedMatchup; worst?: RatedMatchup }
}) {
  const { t } = useTranslation()
  const formatCount = useFormat(countFormat)

  if (scope === 'global') {
    // Every game is counted once from each side, so the sum over every cell is two per game.
    const games = Math.round(total.games / 2)
    return (
      <Summary>
        <SummaryItem>
          <SummaryLabel>{t('users.profile.matchups.games', 'Games')}</SummaryLabel>
          <SummaryFigure>{formatCount.format(games)}</SummaryFigure>
        </SummaryItem>
        {extremes.best ? (
          <SummaryMatchupItem
            label={t('users.profile.matchups.mostOneSided', 'Most one-sided')}
            matchup={extremes.best}
          />
        ) : undefined}
      </Summary>
    )
  }

  const rate = total.games ? Math.round((total.wins / total.games) * 100) : 0
  return (
    <Summary>
      <SummaryItem>
        <SummaryLabel>{t('users.profile.matchups.winRate', 'Win rate')}</SummaryLabel>
        <SummaryFigure $tone={rate >= 50 ? 'positive' : 'negative'}>{rate}%</SummaryFigure>
        <SummaryDetail>
          {total.wins}&ndash;{total.games - total.wins}
        </SummaryDetail>
      </SummaryItem>
      {extremes.best ? (
        <SummaryMatchupItem
          label={t('users.profile.matchups.bestMatchup', 'Best matchup')}
          matchup={extremes.best}
        />
      ) : undefined}
      {extremes.worst ? (
        <SummaryMatchupItem
          label={t('users.profile.matchups.worstMatchup', 'Toughest matchup')}
          matchup={extremes.worst}
        />
      ) : undefined}
    </Summary>
  )
}
