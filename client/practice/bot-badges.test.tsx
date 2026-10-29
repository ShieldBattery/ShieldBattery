import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { MatchmakingDivision } from '../../common/matchmaking'
import { botRatingToDivision, ProductionVisibilityBadge } from './bot-badges'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

test('bot strength uses current solo division bounds without a season bonus pool', () => {
  expect(botRatingToDivision(1399)).toBe(MatchmakingDivision.Silver3)
  expect(botRatingToDivision(1400)).toBe(MatchmakingDivision.Gold1)
  expect(botRatingToDivision(2120)).toBe(MatchmakingDivision.Champion)
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
