import { timeAgo } from './time-ago'

const SECONDS = 1000
const MINUTES = 60 * 1000
const HOURS = 60 * MINUTES
const DAYS = 24 * HOURS
const WEEKS = 7 * DAYS

describe('client/time/time-ago/timeAgo', () => {
  test('seconds', () => {
    expect(timeAgo(500)).toMatchInlineSnapshot(`"0s ago"`)
    expect(timeAgo(1500)).toMatchInlineSnapshot(`"1s ago"`)
    expect(timeAgo(2000)).toMatchInlineSnapshot(`"2s ago"`)
    expect(timeAgo(55000)).toMatchInlineSnapshot(`"55s ago"`)
    expect(timeAgo(59000)).toMatchInlineSnapshot(`"59s ago"`)
  })

  test('minutes', () => {
    expect(timeAgo(1 * MINUTES)).toMatchInlineSnapshot(`"1m ago"`)
    expect(timeAgo(1 * MINUTES + 5 * SECONDS)).toMatchInlineSnapshot(`"1m ago"`)
    expect(timeAgo(30 * MINUTES)).toMatchInlineSnapshot(`"30m ago"`)
    expect(timeAgo(59 * MINUTES + 5 * SECONDS)).toMatchInlineSnapshot(`"59m ago"`)
  })

  test('hours', () => {
    expect(timeAgo(1 * HOURS)).toMatchInlineSnapshot(`"1h ago"`)
    expect(timeAgo(1 * HOURS + 45 * MINUTES)).toMatchInlineSnapshot(`"1h ago"`)
    expect(timeAgo(23 * HOURS + 45 * MINUTES)).toMatchInlineSnapshot(`"23h ago"`)
  })

  test('days', () => {
    expect(timeAgo(1 * DAYS)).toMatchInlineSnapshot(`"1d ago"`)
    expect(timeAgo(1 * DAYS + 15 * HOURS)).toMatchInlineSnapshot(`"1d ago"`)
    expect(timeAgo(6 * DAYS + 15 * HOURS)).toMatchInlineSnapshot(`"6d ago"`)
  })

  test('weeks', () => {
    expect(timeAgo(1 * WEEKS)).toMatchInlineSnapshot(`"1w ago"`)
    expect(timeAgo(1 * WEEKS + 5 * DAYS)).toMatchInlineSnapshot(`"1w ago"`)
    expect(timeAgo(3 * WEEKS + 5 * DAYS)).toMatchInlineSnapshot(`"3w ago"`)
  })

  test('months', () => {
    expect(timeAgo(5 * WEEKS)).toMatchInlineSnapshot(`"1mo ago"`)
    expect(timeAgo(40 * WEEKS + 5 * DAYS)).toMatchInlineSnapshot(`"9mo ago"`)
    expect(timeAgo(51 * WEEKS)).toMatchInlineSnapshot(`"11mo ago"`)
  })

  test('years', () => {
    expect(timeAgo(53 * WEEKS)).toMatchInlineSnapshot(`"1y ago"`)
    expect(timeAgo(800 * WEEKS)).toMatchInlineSnapshot(`"15y ago"`)
    expect(timeAgo(9000 * WEEKS)).toMatchInlineSnapshot(`"172y ago"`)
  })
})
