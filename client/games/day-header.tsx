import { TFunction } from 'i18next'
import { ReactNode } from 'react'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { GameSortOption } from '../../common/games/game-filters'
import { GameRecordJson } from '../../common/games/games'
import { labelMedium, titleSmall } from '../styles/typography'

const dayHeaderDateFormat = new Intl.DateTimeFormat(navigator.language, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})
const dayHeaderDateFormatWithYear = new Intl.DateTimeFormat(navigator.language, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

/** Returns the local start-of-day (midnight) timestamp, in unix ms, for a given instant. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Returns the local start-of-day timestamps for today and yesterday (used to label day headers).
 * Kept out of component render bodies so the `Date.now()` read doesn't trip the render-purity
 * lint rule.
 */
export function getDayBoundaries(): { todayStartMs: number; yesterdayStartMs: number } {
  const todayStartMs = startOfLocalDay(Date.now())
  return { todayStartMs, yesterdayStartMs: startOfLocalDay(todayStartMs - 1) }
}

/** Formats the label for a day header ("Today", "Yesterday", or a localized date). */
export function formatDayHeaderLabel(
  dayStartMs: number,
  todayStartMs: number,
  yesterdayStartMs: number,
  t: TFunction,
): string {
  if (dayStartMs === todayStartMs) {
    return t('games.dayHeader.today', 'Today')
  }
  if (dayStartMs === yesterdayStartMs) {
    return t('games.dayHeader.yesterday', 'Yesterday')
  }
  // Older entries can span years, so include the year whenever it isn't the current one.
  return new Date(dayStartMs).getFullYear() === new Date(todayStartMs).getFullYear()
    ? dayHeaderDateFormat.format(dayStartMs)
    : dayHeaderDateFormatWithYear.format(dayStartMs)
}

const DayHeaderRoot = styled.div`
  ${titleSmall};

  display: flex;
  align-items: baseline;
  gap: 8px;

  padding: 16px 8px 8px;

  background-color: var(--theme-surface);
  color: var(--theme-on-surface);
`

const DayHeaderCount = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const DayHeaderRule = styled.div`
  flex-grow: 1;
  height: 1px;
  align-self: center;

  background-color: var(--theme-outline-variant);
`

/**
 * A horizontal separator labeling a calendar day within a chronological list of games or replays.
 * Purely presentational: callers compute the label (see `formatDayHeaderLabel`) and any count
 * text themselves.
 */
export function DayHeader({
  label,
  countLabel,
  className,
}: {
  label: string
  /** Optional secondary text after the label (e.g. "12 replays"). */
  countLabel?: string
  className?: string
}) {
  return (
    <DayHeaderRoot className={className}>
      <span>{label}</span>
      {countLabel ? <DayHeaderCount>{countLabel}</DayHeaderCount> : null}
      <DayHeaderRule />
    </DayHeaderRoot>
  )
}

function isDateSort(sort: GameSortOption): boolean {
  return sort === GameSortOption.LatestFirst || sort === GameSortOption.OldestFirst
}

/**
 * Renders `games` with `renderGame`, inserting a `DayHeader` before the first game of each
 * distinct local calendar day when `sort` is date-based. For Shortest/Longest sorts, games aren't
 * grouped chronologically, so no headers are inserted. No per-day counts are shown, since these
 * lists are server-paginated and a count derived from the loaded rows would be wrong.
 */
export function renderGamesWithDayHeaders(
  games: ReadonlyArray<ReadonlyDeep<GameRecordJson>>,
  sort: GameSortOption,
  t: TFunction,
  renderGame: (game: ReadonlyDeep<GameRecordJson>) => ReactNode,
): ReactNode[] {
  if (!isDateSort(sort)) {
    return games.map(renderGame)
  }

  const { todayStartMs, yesterdayStartMs } = getDayBoundaries()
  const items: ReactNode[] = []
  let lastDayStartMs: number | undefined
  for (const game of games) {
    const dayStartMs = startOfLocalDay(game.startTime)
    if (dayStartMs !== lastDayStartMs) {
      items.push(
        <DayHeader
          key={`day-${dayStartMs}`}
          label={formatDayHeaderLabel(dayStartMs, todayStartMs, yesterdayStartMs, t)}
        />,
      )
      lastDayStartMs = dayStartMs
    }
    items.push(renderGame(game))
  }
  return items
}
