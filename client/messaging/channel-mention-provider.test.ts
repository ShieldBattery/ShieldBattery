import { describe, expect, test } from 'vitest'
import { BasicChannelInfo, makeSbChannelId, SbChannelId } from '../../common/chat'
import {
  createChannelMentionProvider,
  getMentionableChannels,
  MentionableChannel,
} from './channel-mention-provider'
import { MAX_TYPEAHEAD_ROWS, TypeaheadSuggestion } from './typeahead'

function makeChannels(names: ReadonlyArray<string>): MentionableChannel[] {
  return names.map((name, i) => ({ id: makeSbChannelId(i + 1), name }))
}

function suggestions(
  channels: ReadonlyArray<MentionableChannel>,
  text: string,
): ReadonlyArray<TypeaheadSuggestion> | undefined {
  const match = createChannelMentionProvider(() => channels).match(text)
  return match?.suggestions as ReadonlyArray<TypeaheadSuggestion> | undefined
}

function suggestedNames(channels: ReadonlyArray<MentionableChannel>, text: string): string[] {
  return (suggestions(channels, text) ?? []).map(s => s.text)
}

const channels = makeChannels(['ShieldBattery', 'Korean', 'bw-strats', 'ko', 'koreanstuff'])

describe('messaging/channel-mention-provider', () => {
  test('a bare # offers every channel in the order given', () => {
    expect(suggestedNames(channels, '#')).toEqual([
      'ShieldBattery',
      'Korean',
      'bw-strats',
      'ko',
      'koreanstuff',
    ])
    expect(suggestedNames(channels, 'look at #')).toEqual(suggestedNames(channels, '#'))
  })

  test('a bare # offers no more than fit in the palette', () => {
    const many = makeChannels(Array.from({ length: 15 }, (_, i) => `channel${i}`))

    expect(suggestedNames(many, '#')).toHaveLength(MAX_TYPEAHEAD_ROWS)
  })

  test('an exact match comes first, ignoring case', () => {
    expect(suggestedNames(channels, '#KO')).toEqual(['ko', 'Korean', 'koreanstuff'])
  })

  test('typed characters narrow the channels fuzzily', () => {
    expect(suggestedNames(channels, '#sb')).toEqual(['ShieldBattery'])
    expect(suggestedNames(channels, '#bws')).toEqual(['bw-strats'])
  })

  test('only a # at the start or after whitespace opens the palette', () => {
    expect(suggestions(channels, 'foo#')).toBeUndefined()
    expect(suggestions(channels, 'foo#ko')).toBeUndefined()
    expect(suggestedNames(channels, 'foo #ko')).toEqual(['ko', 'Korean', 'koreanstuff'])
  })

  test('a # followed by what could never be a channel name offers nothing', () => {
    expect(suggestions(channels, '#ko/')).toBeUndefined()
  })

  test('the palette closes once the caret has moved past the mention', () => {
    expect(suggestions(channels, '#ko ')).toBeUndefined()
  })

  test('accepting a channel inserts its name as a mention', () => {
    const match = createChannelMentionProvider(() => channels).match('hi #kor')!

    expect(match.start).toBe(3)
    expect(match.matchedText).toBe('#kor')
    const [first] = match.suggestions as ReadonlyArray<TypeaheadSuggestion>
    expect(first.insertText).toBe('#Korean ')
    expect(first.visual).toEqual({ kind: 'channel', channelId: makeSbChannelId(2) })
  })

  test('the channels are read anew on every match', () => {
    let current = makeChannels(['first'])
    const provider = createChannelMentionProvider(() => current)
    current = makeChannels(['second'])

    const match = provider.match('#')!
    expect((match.suggestions as ReadonlyArray<TypeaheadSuggestion>).map(s => s.text)).toEqual([
      'second',
    ])
  })
})

describe('messaging/channel-mention-provider/getMentionableChannels', () => {
  test('lists joined channels in the order they were joined, skipping unknown ones', () => {
    const info = (id: number, name: string): [SbChannelId, BasicChannelInfo] => [
      makeSbChannelId(id),
      { id: makeSbChannelId(id), name, private: false, official: false, closed: false },
    ]

    expect(
      getMentionableChannels({
        joinedChannels: new Set([makeSbChannelId(3), makeSbChannelId(1), makeSbChannelId(7)]),
        idToBasicInfo: new Map([info(1, 'one'), info(2, 'two'), info(3, 'three')]),
      }),
    ).toEqual([
      { id: makeSbChannelId(3), name: 'three' },
      { id: makeSbChannelId(1), name: 'one' },
    ])
  })
})
