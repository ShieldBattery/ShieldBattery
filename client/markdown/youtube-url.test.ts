import { describe, expect, test } from 'vitest'
import { parseYoutubeUrl } from './youtube-url'

const ID = 'dQw4w9WgXcQ'

describe('markdown/youtube-url', () => {
  test.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?feature=share&v=${ID}&list=PL123`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc123`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://WWW.YOUTUBE.COM/watch?v=${ID}`,
  ])('parses %s', url => {
    expect(parseYoutubeUrl(url)).toEqual({ id: ID })
  })

  test.each([
    ['plain seconds', `https://youtu.be/${ID}?t=90`, 90],
    ['seconds with a unit', `https://www.youtube.com/watch?v=${ID}&t=90s`, 90],
    ['a minutes/seconds duration', `https://www.youtube.com/watch?v=${ID}&t=1m30s`, 90],
    ['an hours/minutes/seconds duration', `https://youtu.be/${ID}?t=1h2m3s`, 3723],
    ['the start param', `https://www.youtube.com/embed/${ID}?start=45`, 45],
  ])('reads a start time from %s', (_, url, startSeconds) => {
    expect(parseYoutubeUrl(url)).toEqual({ id: ID, startSeconds })
  })

  test.each([
    ['a zero start time', `https://youtu.be/${ID}?t=0`],
    ['a malformed start time', `https://youtu.be/${ID}?t=soon`],
  ])('ignores %s', (_, url) => {
    expect(parseYoutubeUrl(url)).toEqual({ id: ID })
  })

  test.each([
    ['a non-YouTube host', `https://example.com/watch?v=${ID}`],
    ['a lookalike host', `https://youtube.com.example.com/watch?v=${ID}`],
    ['a channel page', 'https://www.youtube.com/@ShieldBattery'],
    ['a playlist without a video', 'https://www.youtube.com/playlist?list=PL123'],
    ['a watch URL without a video', 'https://www.youtube.com/watch'],
    ['a too-short ID', 'https://youtu.be/abc'],
    ['an ID with invalid characters', 'https://youtu.be/dQw4w9WgX%3F'],
    ['extra path segments', `https://youtu.be/${ID}/extra`],
    ['a non-http scheme', `javascript://youtu.be/${ID}`],
    ['a relative URL', `/watch?v=${ID}`],
  ])('rejects %s', (_, url) => {
    expect(parseYoutubeUrl(url)).toBeUndefined()
  })
})
