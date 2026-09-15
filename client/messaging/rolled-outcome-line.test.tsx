import { render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { beforeAll, describe, expect, test } from 'vitest'
import { QUOTE_UNITS, UNIT_QUOTES } from '../../common/unit-quotes'
import { quoteLineText } from './quote-catalogue'
import { RolledOutcomeLine } from './rolled-outcome-line'

// The line is built with `Trans`, which needs an i18next instance to render against. `escapeValue`
// matches how the app initializes i18next: React escapes what it renders, so escaping again would
// put entities on screen in place of the punctuation these lines are made of.
beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

describe('client/messaging/rolled-outcome-line', () => {
  test('a roll reads the settled value and range, with the value in a chip', () => {
    render(<RolledOutcomeLine outcome={{ kind: 'roll', max: 100, value: 42 }} text='' />)

    expect(screen.getByText(/rolls/)).toBeDefined()
    expect(screen.getByText(/\(1-100\)/)).toBeDefined()
    expect(screen.getByTestId('outcome-chip').textContent).toBe('42')
  })

  test('a flip reads the settled side in a chip', () => {
    render(<RolledOutcomeLine outcome={{ kind: 'flip', result: 'tails' }} text='' />)

    expect(screen.getByText(/flips a coin/)).toBeDefined()
    expect(screen.getByTestId('outcome-chip').textContent).toBe('tails')
  })

  test('an 8-ball reads the question typed by the user and the settled answer in a chip', () => {
    render(
      <RolledOutcomeLine
        outcome={{ kind: 'eightBall', answer: 'myReplyIsNo' }}
        text='am I done?'
      />,
    )

    expect(screen.getByText(/asks the 8-ball/)).toBeDefined()
    expect(screen.getByText(/am I done\?/)).toBeDefined()
    expect(screen.getByTestId('outcome-chip').textContent).toBe('My reply is no')
  })

  test('a quote reads the settled line, with the unit that says it in a chip', () => {
    render(
      <RolledOutcomeLine
        outcome={{ kind: 'quote', unit: 'firebat', line: 'needALight' }}
        text=''
      />,
    )

    expect(screen.getByText(/quotes the/)).toBeDefined()
    expect(screen.getByTestId('outcome-chip').textContent).toBe('Firebat')
    expect(screen.getByText(/Need a light\?/)).toBeDefined()
  })

  test('every line the server can settle on has text to show for it', () => {
    const t = i18next.t

    for (const unit of QUOTE_UNITS) {
      for (const line of UNIT_QUOTES[unit]) {
        const text = quoteLineText(unit, line, t)

        expect(text.length).toBeGreaterThan(0)
        // A missing entry falls back to the key itself, which is what this catches.
        expect(text).not.toBe(line)
      }
    }
  })
})
