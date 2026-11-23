import { describe, expect, test } from 'vitest'
import { parseActiveBuildKey } from './build-info'

const HEADER =
  'Branch!STRING:0|Active!DEC:1|Build Key!HEX:16|CDN Key!HEX:16|Version!STRING:0|Product!STRING:0'

describe('app/map-library/build-info/parseActiveBuildKey', () => {
  test("returns the active row's build key", () => {
    const buildInfo = [
      HEADER,
      'us|0|11111111111111111111111111111111|aa|1.23.9.1|s1',
      'eu|1|864772B9FF94F6D372AA4EE90EE2F8AB|bb|1.23.10.13515|s1',
      '',
    ].join('\r\n')
    expect(parseActiveBuildKey(buildInfo)).toBe('864772b9ff94f6d372aa4ee90ee2f8ab')
  })

  test('returns nothing without an active row or a usable build key', () => {
    expect(parseActiveBuildKey(`${HEADER}\nus|0|1111|aa|1.23.9.1|s1`)).toBeUndefined()
    expect(parseActiveBuildKey(`${HEADER}\nus|1||aa|1.23.9.1|s1`)).toBeUndefined()
    expect(parseActiveBuildKey('Branch!STRING:0|Active!DEC:1\nus|1')).toBeUndefined()
    expect(parseActiveBuildKey('')).toBeUndefined()
  })
})
