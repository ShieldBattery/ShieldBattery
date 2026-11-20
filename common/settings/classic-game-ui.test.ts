import { expect, test } from 'vitest'
import { DEFAULT_LOCAL_SETTINGS } from './default-settings'

test('new profiles retain the current ShieldBattery interface by default', () => {
  expect(DEFAULT_LOCAL_SETTINGS.classicGameUi).toBe(false)
})
