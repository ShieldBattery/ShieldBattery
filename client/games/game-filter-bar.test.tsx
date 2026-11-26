import { fireEvent, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { GameDurationFilter, GameSortOption } from '../../common/games/game-filters'
import { GameFilterBar } from './game-filter-bar'

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Renders the filter bar on local date `today`, picks the quick range labeled `presetLabel` and
 * applies it, returning the `yyyy-mm-dd` range the bar reported.
 */
function applyPresetOn(today: Date, presetLabel: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(today)

  const setStartDate = vi.fn()
  const setEndDate = vi.fn()
  const { unmount } = render(
    <GameFilterBar
      duration={GameDurationFilter.All}
      setDuration={vi.fn()}
      sort={GameSortOption.LatestFirst}
      setSort={vi.fn()}
      mapName=''
      setMapName={vi.fn()}
      playerName=''
      setPlayerName={vi.fn()}
      setFormat={vi.fn()}
      setMatchup={vi.fn()}
      hideShort={false}
      setHideShort={vi.fn()}
      setStartDate={setStartDate}
      setEndDate={setEndDate}
    />,
  )

  fireEvent.click(screen.getByText('Date'))
  fireEvent.click(screen.getByText(presetLabel))
  fireEvent.click(screen.getByText('Apply'))
  unmount()

  return {
    startDate: setStartDate.mock.lastCall?.[0],
    endDate: setEndDate.mock.lastCall?.[0],
  }
}

describe('client/games/game-filter-bar date presets', () => {
  test('past week starts 7 days back', () => {
    expect(applyPresetOn(new Date(2026, 2, 3, 12), 'Past week')).toEqual({
      startDate: '2026-02-24',
      endDate: '2026-03-03',
    })
  })

  test('past month starts mid-month on the same day of the previous month', () => {
    expect(applyPresetOn(new Date(2026, 5, 15, 12), 'Past month')).toEqual({
      startDate: '2026-05-15',
      endDate: '2026-06-15',
    })
  })

  test('past month clamps to the end of a shorter previous month', () => {
    expect(applyPresetOn(new Date(2026, 2, 31, 12), 'Past month')).toEqual({
      startDate: '2026-02-28',
      endDate: '2026-03-31',
    })
    expect(applyPresetOn(new Date(2028, 2, 31, 12), 'Past month')).toEqual({
      startDate: '2028-02-29',
      endDate: '2028-03-31',
    })
  })

  test('past 3 months clamps to the end of a shorter month', () => {
    expect(applyPresetOn(new Date(2026, 4, 31, 12), 'Past 3 months')).toEqual({
      startDate: '2026-02-28',
      endDate: '2026-05-31',
    })
  })

  test('past year from a leap day clamps to Feb 28', () => {
    expect(applyPresetOn(new Date(2028, 1, 29, 12), 'Past year')).toEqual({
      startDate: '2027-02-28',
      endDate: '2028-02-29',
    })
  })
})
