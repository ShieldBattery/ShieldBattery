import { BwUserLatency, turnRateToMaxLatency } from './network'

describe('common/network', () => {
  describe('turnRateToMaxLatency', () => {
    it('gives correct values', () => {
      expect(turnRateToMaxLatency(24, BwUserLatency.Low)).toBe(125)
      expect(turnRateToMaxLatency(24, BwUserLatency.High)).toBe(166.66666666666666)
      expect(turnRateToMaxLatency(24, BwUserLatency.ExtraHigh)).toBe(208.33333333333334)

      expect(turnRateToMaxLatency(20, BwUserLatency.Low)).toBe(150)
      expect(turnRateToMaxLatency(20, BwUserLatency.High)).toBe(200)
      expect(turnRateToMaxLatency(20, BwUserLatency.ExtraHigh)).toBe(250)

      expect(turnRateToMaxLatency(16, BwUserLatency.Low)).toBe(187.5)
      expect(turnRateToMaxLatency(16, BwUserLatency.High)).toBe(250)
      expect(turnRateToMaxLatency(16, BwUserLatency.ExtraHigh)).toBe(312.5)

      expect(turnRateToMaxLatency(14, BwUserLatency.Low)).toBe(214.28571428571428)
      expect(turnRateToMaxLatency(14, BwUserLatency.High)).toBe(285.7142857142857)
      expect(turnRateToMaxLatency(14, BwUserLatency.ExtraHigh)).toBe(357.14285714285717)

      expect(turnRateToMaxLatency(12, BwUserLatency.Low)).toBe(250)
      expect(turnRateToMaxLatency(12, BwUserLatency.High)).toBe(333.3333333333333)
      expect(turnRateToMaxLatency(12, BwUserLatency.ExtraHigh)).toBe(416.6666666666667)

      expect(turnRateToMaxLatency(10, BwUserLatency.Low)).toBe(300)
      expect(turnRateToMaxLatency(10, BwUserLatency.High)).toBe(400)
      expect(turnRateToMaxLatency(10, BwUserLatency.ExtraHigh)).toBe(500)

      expect(turnRateToMaxLatency(8, BwUserLatency.Low)).toBe(375)
      expect(turnRateToMaxLatency(8, BwUserLatency.High)).toBe(500)
      expect(turnRateToMaxLatency(8, BwUserLatency.ExtraHigh)).toBe(625)
    })
  })
})
