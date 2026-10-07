import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { RaceChar, raceCharToLabel, RaceStats } from '../../common/races'
import { numberFormat, useFormat, useFormatLocale } from '../i18n/locale-formats'
import { Tooltip, TooltipContent, TooltipPosition } from '../material/tooltip'
import { getRaceColor } from '../styles/colors'
import { labelMedium } from '../styles/typography'

/** A fixed order, so shares are in the same place for every player and can be compared at a glance. */
const RACE_ORDER: ReadonlyArray<RaceChar> = ['t', 'p', 'z', 'r']

const percentFormat = numberFormat({ style: 'percent', maximumFractionDigits: 0 })

/**
 * Returns how many games were played with each race *selected*. Games played as Random count
 * towards Random, whichever race they were assigned.
 */
export function getRaceSelectionCounts(stats: Readonly<RaceStats>): Record<RaceChar, number> {
  return {
    p: stats.pWins + stats.pLosses,
    t: stats.tWins + stats.tLosses,
    z: stats.zWins + stats.zLosses,
    r: stats.rWins + stats.rLosses,
  }
}

// The default tooltip is a light surface, which most of the race colors don't have enough contrast
// against, so this uses a dark one instead.
const ShareContent = styled(TooltipContent)`
  display: block;
  padding: 8px 12px;

  border-color: var(--theme-outline-variant);
  background-color: var(--theme-container-highest);
  color: var(--theme-on-surface);
`

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 4px;

  color: var(--theme-on-surface-variant);
`

const ShareRow = styled.div<{ $empty: boolean }>`
  ${labelMedium};
  min-height: 20px;

  display: grid;
  grid-template-columns: auto 120px 40px;
  align-items: center;
  column-gap: 8px;

  color: ${props => (props.$empty ? 'var(--theme-on-surface-variant)' : 'inherit')};
`

const ShareBar = styled.div`
  height: 6px;
  border-radius: 3px;
  overflow: hidden;

  background-color: var(--theme-container-low);
`

const ShareBarFill = styled.div<{ $race: RaceChar }>`
  height: 100%;
  border-radius: 3px;
  background-color: ${props => getRaceColor(props.$race)};
`

const SharePercent = styled.span`
  text-align: right;
  font-variant-numeric: tabular-nums;
`

function RaceSelectionShare({ stats }: { stats: Readonly<RaceStats> }) {
  const { t } = useTranslation()
  const locale = useFormatLocale()
  const percent = useFormat(percentFormat)

  const counts = getRaceSelectionCounts(stats)
  const total = counts.p + counts.t + counts.z + counts.r

  return (
    <>
      <Header>
        <span>{t('users.raceSelection.title', 'Race selection')}</span>
        <span>
          {t('users.raceSelection.gameCount', {
            defaultValue: '{{total}} games',
            defaultValue_one: '{{total}} game',
            count: total,
            total: total.toLocaleString(locale),
          })}
        </span>
      </Header>
      {RACE_ORDER.map(race => {
        const share = total > 0 ? counts[race] / total : 0
        // Rounding would show a race that was played, just rarely, as 0%, which reads as never.
        const shareText =
          share > 0 && share < 0.005
            ? t('users.raceSelection.lessThan', '<{{percent}}', { percent: percent.format(0.01) })
            : percent.format(share)

        return (
          <ShareRow key={race} $empty={counts[race] === 0}>
            <span>{raceCharToLabel(race, t)}</span>
            <ShareBar aria-hidden={true}>
              <ShareBarFill $race={race} style={{ width: `${share * 100}%` }} />
            </ShareBar>
            <SharePercent>{shareText}</SharePercent>
          </ShareRow>
        )
      })}
    </>
  )
}

export interface RaceSelectionTooltipProps {
  stats: Readonly<RaceStats>
  children: React.ReactNode
  className?: string
  position?: TooltipPosition
}

/**
 * A tooltip showing what share of a player's games were played with each race selected. Disabled
 * if the player hasn't played any games.
 */
export function RaceSelectionTooltip({
  stats,
  children,
  className,
  position = 'bottom',
}: RaceSelectionTooltipProps) {
  const counts = getRaceSelectionCounts(stats)
  const total = counts.p + counts.t + counts.z + counts.r

  return (
    <Tooltip
      className={className}
      text={<RaceSelectionShare stats={stats} />}
      position={position}
      ContentComponent={ShareContent}
      disabled={total === 0}>
      {children}
    </Tooltip>
  )
}
