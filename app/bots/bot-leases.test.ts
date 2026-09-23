import { describe, expect, test } from 'vitest'
import { BotLeases } from './bot-leases'

describe('BotLeases', () => {
  test('a launch that conflicts with a running game is rejected without touching its lease', () => {
    const leases = new BotLeases()
    const running = leases.acquire(['zzzkbot', 'purplewave'])

    expect(() => leases.acquire(['zzzkbot', 'steamhammer'])).toThrow(/being used by a game/)
    expect(leases.has('zzzkbot')).toBe(true)
    expect(leases.has('steamhammer'), 'a rejected launch takes nothing').toBe(false)

    expect(leases.release(running)).toBe(true)
    expect(leases.keys()).toEqual(new Set())
  })

  test('releasing one launch leaves bots another launch holds', () => {
    const leases = new BotLeases()
    const first = leases.acquire(['zzzkbot'])
    const second = leases.acquire(['purplewave'])

    expect(leases.release(first)).toBe(true)
    expect(leases.keys()).toEqual(new Set(['purplewave']))
    expect(leases.release(first), 'a lease is released once').toBe(false)
    expect(leases.release(second)).toBe(true)
  })

  test('one launch can seat the same bot several times', () => {
    const leases = new BotLeases()
    const lease = leases.acquire(['zzzkbot', 'zzzkbot'])

    expect(leases.keys()).toEqual(new Set(['zzzkbot']))
    expect(leases.release(lease)).toBe(true)
    expect(leases.has('zzzkbot')).toBe(false)
  })
})
