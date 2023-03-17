import { RelativeTimeFormatter } from './relative-time'

describe('RelativeTimeFormatter', () => {
  let formatter: RelativeTimeFormatter

  beforeEach(() => {
    formatter = new RelativeTimeFormatter('en', { style: 'narrow', numeric: 'always' })
  })

  describe('format', () => {
    test('years', () => {
      expect(formatter.format('2000-01-01', '2001-01-01')).toBe('1y ago')
      expect(formatter.format('2000-01-01', '2002-01-01')).toBe('2y ago')
      expect(formatter.format('2000-01-01', '2002-12-30')).toBe('2y ago')

      expect(formatter.format('2001-01-01', '2000-01-01')).toBe('in 1y')
      expect(formatter.format('2002-01-01', '2000-01-01')).toBe('in 2y')
      expect(formatter.format('2002-12-30', '2000-01-01')).toBe('in 2y')
    })

    test('months', () => {
      expect(formatter.format('2000-01-01', '2000-02-01')).toBe('1mo ago')
      expect(formatter.format('2000-01-01', '2000-03-01')).toBe('2mo ago')
      expect(formatter.format('2000-01-01', '2000-03-15')).toBe('2mo ago')
      expect(formatter.format('2000-01-01', '2000-12-20')).toBe('11mo ago')

      expect(formatter.format('2000-02-01', '2000-01-01')).toBe('in 1mo')
      expect(formatter.format('2000-03-01', '2000-01-01')).toBe('in 2mo')
      expect(formatter.format('2000-03-15', '2000-01-01')).toBe('in 2mo')
      expect(formatter.format('2000-12-20', '2000-01-01')).toBe('in 11mo')
    })

    test('weeks', () => {
      expect(formatter.format('2000-01-01', '2000-01-08')).toBe('1w ago')
      expect(formatter.format('2000-01-01', '2000-01-15')).toBe('2w ago')
      expect(formatter.format('2000-01-01', '2000-01-20')).toBe('2w ago')
      expect(formatter.format('2000-01-01', '2000-01-30')).toBe('4w ago')

      expect(formatter.format('2000-01-08', '2000-01-01')).toBe('in 1w')
      expect(formatter.format('2000-01-15', '2000-01-01')).toBe('in 2w')
      expect(formatter.format('2000-01-20', '2000-01-01')).toBe('in 2w')
      expect(formatter.format('2000-01-30', '2000-01-01')).toBe('in 4w')
    })

    test('days', () => {
      expect(formatter.format('2000-01-01', '2000-01-02')).toBe('1d ago')
      expect(formatter.format('2000-01-01', '2000-01-03')).toBe('2d ago')
      expect(formatter.format('2000-01-01', '2000-01-03T14:00:00')).toBe('2d ago')
      expect(formatter.format('2000-01-01', '2000-01-07')).toBe('6d ago')

      expect(formatter.format('2000-01-02', '2000-01-01')).toBe('in 1d')
      expect(formatter.format('2000-01-03', '2000-01-01')).toBe('in 2d')
      expect(formatter.format('2000-01-03T14:00:00', '2000-01-01')).toBe('in 2d')
      expect(formatter.format('2000-01-07', '2000-01-01')).toBe('in 6d')
    })

    test('hours', () => {
      expect(formatter.format('2000-01-01T00:00:00', '2000-01-01T01:00:00')).toBe('1h ago')
      expect(formatter.format('2000-01-01T00:00:00', '2000-01-01T02:00:00')).toBe('2h ago')
      expect(formatter.format('2000-01-01T00:00:00', '2000-01-01T02:55:00')).toBe('2h ago')
      expect(formatter.format('2000-01-01T00:00:00', '2000-01-01T23:50:40')).toBe('23h ago')

      expect(formatter.format('2000-01-01T01:00:00', '2000-01-01T00:00:00')).toBe('in 1h')
      expect(formatter.format('2000-01-01T02:00:00', '2000-01-01T00:00:00')).toBe('in 2h')
      expect(formatter.format('2000-01-01T02:55:00', '2000-01-01T00:00:00')).toBe('in 2h')
      expect(formatter.format('2000-01-01T23:50:40', '2000-01-01T00:00:00')).toBe('in 23h')
    })

    test('minutes', () => {
      expect(formatter.format('2000-01-01T00:00:00', '2000-01-01T00:01:00')).toBe('1m ago')
      expect(formatter.format('2000-01-01T00:00:00', '2000-01-01T00:02:00')).toBe('2m ago')
      expect(formatter.format('2000-01-01T00:00:00', '2000-01-01T00:02:55')).toBe('2m ago')
      expect(formatter.format('2000-01-01T00:00:00', '2000-01-01T00:59:00')).toBe('59m ago')

      expect(formatter.format('2000-01-01T00:01:00', '2000-01-01T00:00:00')).toBe('in 1m')
      expect(formatter.format('2000-01-01T00:02:00', '2000-01-01T00:00:00')).toBe('in 2m')
      expect(formatter.format('2000-01-01T00:02:55', '2000-01-01T00:00:00')).toBe('in 2m')
      expect(formatter.format('2000-01-01T00:59:00', '2000-01-01T00:00:00')).toBe('in 59m')
    })

    test('seconds', () => {
      expect(formatter.format('2000-01-01T00:00:00', '2000-01-01T00:00:01')).toBe('1s ago')
      expect(formatter.format('2000-01-01T00:00:00', '2000-01-01T00:00:02')).toBe('2s ago')
      expect(formatter.format('2000-01-01T00:00:00', '2000-01-01T00:00:02.555')).toBe('2s ago')
      expect(formatter.format('2000-01-01T00:00:00', '2000-01-01T00:00:59')).toBe('59s ago')

      expect(formatter.format('2000-01-01T00:00:01', '2000-01-01T00:00:00')).toBe('in 1s')
      expect(formatter.format('2000-01-01T00:00:02', '2000-01-01T00:00:00')).toBe('in 2s')
      expect(formatter.format('2000-01-01T00:00:02.555', '2000-01-01T00:00:00')).toBe('in 2s')
      expect(formatter.format('2000-01-01T00:00:59', '2000-01-01T00:00:00')).toBe('in 59s')
    })

    test('handles numbers', () => {
      expect(formatter.format(0, 1000 * 10)).toBe('10s ago')
    })

    test('handles Dates', () => {
      expect(formatter.format(new Date(0), new Date(1000 * 10))).toBe('10s ago')
    })

    test('handles combination of types', () => {
      expect(formatter.format(0, new Date(1000 * 10))).toBe('10s ago')
    })
  })
})
