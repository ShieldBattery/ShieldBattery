import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  MatchmakingDivision,
  POINTS_FOR_RATING_TARGET_FACTOR,
  pointsToMatchmakingDivision,
} from '../../common/matchmaking'
import { botRatingToDivision, ProductionVisibilityBadge } from './bot-badges'

vi.mock('../../common/matchmaking', async importOriginal => ({
  ...(await importOriginal<typeof import('../../common/matchmaking')>()),
  pointsToMatchmakingDivision: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

test('bot strength converts rating to solo points with no bonus pool', () => {
  vi.mocked(pointsToMatchmakingDivision).mockReturnValue(MatchmakingDivision.Gold1)
  expect(botRatingToDivision(1400)).toBe(MatchmakingDivision.Gold1)
  expect(pointsToMatchmakingDivision).toHaveBeenCalledWith(
    true,
    1400 * POINTS_FOR_RATING_TARGET_FACTOR,
    { bonusPool: 0 },
  )
})

describe('ProductionVisibilityBadge', () => {
  beforeEach(() => vi.unstubAllEnvs())

  test('production omits release-status badges', () => {
    vi.stubEnv('DEV', false)
    const { container } = render(<ProductionVisibilityBadge bot={{ releaseStatus: 'candidate' }} />)
    expect(container.textContent).toBe('')
  })
  test.each([undefined, 'candidate', 'staging'] as const)(
    'clearly labels %s release as hidden in production',
    releaseStatus => {
      render(<ProductionVisibilityBadge bot={{ releaseStatus }} />)
      expect(screen.getByText('Dev only — hidden in production')).toBeDefined()
    },
  )

  test('approved release has no dev-only badge', () => {
    const { container } = render(
      <ProductionVisibilityBadge bot={{ releaseStatus: 'production-approved' }} />,
    )
    expect(container.textContent).toBe('')
  })
})
