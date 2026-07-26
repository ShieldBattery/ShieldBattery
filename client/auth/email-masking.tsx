import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Masks an email address for display, replacing the local part with asterisks (e.g.
 * `********@example.com`). The number of asterisks is clamped so the mask doesn't reveal the exact
 * length of the local part.
 */
export function maskEmail(email: string): string {
  const lastAt = email.lastIndexOf('@')
  const numStars = Math.min(Math.max(6, lastAt), 10)
  return '*'.repeat(numStars) + email.slice(lastAt)
}

/**
 * Hook for displaying an email address that is masked by default and can be toggled to show the
 * full address, e.g. via `RevealEmailLink`.
 */
export function useRevealableEmail(email: string | undefined): {
  /** The text to display: the full email when revealed, the masked version otherwise. */
  emailText: string | undefined
  revealed: boolean
  toggleRevealed: () => void
} {
  const [revealed, setRevealed] = useState(false)

  return {
    emailText: revealed || email === undefined ? email : maskEmail(email),
    revealed,
    toggleRevealed: () => setRevealed(r => !r),
  }
}

/** A link that toggles a revealable email (see `useRevealableEmail`) between masked and full. */
export function RevealEmailLink({
  revealed,
  onClick,
  testName = 'reveal-email-link',
}: {
  revealed: boolean
  onClick: () => void
  testName?: string
}) {
  const { t } = useTranslation()

  return (
    <a
      href='#'
      data-testid={testName}
      onClick={e => {
        onClick()
        e.preventDefault()
      }}>
      {revealed ? t('common.actions.hide', 'Hide') : t('common.actions.reveal', 'Reveal')}
    </a>
  )
}
