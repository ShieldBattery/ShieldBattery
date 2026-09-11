import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ChatCommand, CommandArgUsage } from './command-schema'
import { CommandSignatureHelp } from './command-signature-help'

const command: ChatCommand = {
  name: 'kick',
  description: () => 'Kicks a user out of this channel.',
  surfaces: ['channel'],
  args: [],
  run: () => {},
}

const signature: ReadonlyArray<CommandArgUsage> = [
  { label: 'user', optional: false },
  { label: 'reason', optional: true },
]

function renderSignature(active: 'name' | number | undefined) {
  render(
    <div data-testid='signature'>
      <CommandSignatureHelp command={command} signature={signature} active={active} />
    </div>,
  )
  return screen.getByTestId('signature')
}

describe('messaging/commands/command-signature-help', () => {
  test('emphasizes the command name while it is being typed', () => {
    const container = renderSignature('name')

    expect(container.textContent).toBe('/kick <user> [reason]')

    const activeParts = container.querySelectorAll('[aria-current="true"]')
    expect(activeParts).toHaveLength(1)
    expect(activeParts[0].textContent).toBe('/kick')
  })

  test('emphasizes the argument the caret is in', () => {
    const container = renderSignature(1)

    expect(container.textContent).toBe('/kick <user> [reason]')

    const activeParts = container.querySelectorAll('[aria-current="true"]')
    expect(activeParts).toHaveLength(1)
    expect(activeParts[0].textContent?.trim()).toBe('[reason]')
  })

  test('emphasizes nothing when the caret is past every argument', () => {
    const container = renderSignature(undefined)

    expect(container.textContent).toBe('/kick <user> [reason]')
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(0)
  })
})
