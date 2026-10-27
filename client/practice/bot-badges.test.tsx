import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ProductionVisibilityBadge } from './bot-badges'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

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
