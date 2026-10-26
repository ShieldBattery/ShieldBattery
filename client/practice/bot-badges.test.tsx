import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { ProductionVisibilityBadge } from './bot-badges'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

describe('ProductionVisibilityBadge', () => {
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
