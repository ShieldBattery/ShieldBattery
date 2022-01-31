import { BwUserLatency, turnRateToMaxLatency } from './network'

describe('common/network', () => {
  describe('turnRateToMaxLatency', () => {
    it('gives correct values', () => {
      expect(turnRateToMaxLatency(24, BwUserLatency.Low)).toBe(63.33333333333333)
      expect(turnRateToMaxLatency(24, BwUserLatency.High)).toBe(105)
      expect(turnRateToMaxLatency(24, BwUserLatency.ExtraHigh)).toBe(146.66666666666666)

      expect(turnRateToMaxLatency(20, BwUserLatency.Low)).toBe(80)
      expect(turnRateToMaxLatency(20, BwUserLatency.High)).toBe(130)
      expect(turnRateToMaxLatency(20, BwUserLatency.ExtraHigh)).toBe(180)

      expect(turnRateToMaxLatency(16, BwUserLatency.Low)).toBe(105)
      expect(turnRateToMaxLatency(16, BwUserLatency.High)).toBe(167.5)
      expect(turnRateToMaxLatency(16, BwUserLatency.ExtraHigh)).toBe(230)

      expect(turnRateToMaxLatency(14, BwUserLatency.Low)).toBe(122.85714285714286)
      expect(turnRateToMaxLatency(14, BwUserLatency.High)).toBe(194.28571428571428)
      expect(turnRateToMaxLatency(14, BwUserLatency.ExtraHigh)).toBe(265.7142857142857)

      expect(turnRateToMaxLatency(12, BwUserLatency.Low)).toBe(146.66666666666666)
      expect(turnRateToMaxLatency(12, BwUserLatency.High)).toBe(230)
      expect(turnRateToMaxLatency(12, BwUserLatency.ExtraHigh)).toBe(313.3333333333333)

      expect(turnRateToMaxLatency(10, BwUserLatency.Low)).toBe(180)
      expect(turnRateToMaxLatency(10, BwUserLatency.High)).toBe(280)
      expect(turnRateToMaxLatency(10, BwUserLatency.ExtraHigh)).toBe(380)

      expect(turnRateToMaxLatency(8, BwUserLatency.Low)).toBe(230)
      expect(turnRateToMaxLatency(8, BwUserLatency.High)).toBe(355)
      expect(turnRateToMaxLatency(8, BwUserLatency.ExtraHigh)).toBe(480)
    })
  })
})
