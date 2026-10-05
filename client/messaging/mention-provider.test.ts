import { describe, expect, test } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { createMentionProvider, MAX_MENTIONED_USERS, MentionableUser } from './mention-provider'
import { TypeaheadSuggestion } from './typeahead'

/** Online users followed by offline ones, the order a channel hands the provider its members. */
function makeUsers(online: ReadonlyArray<string>, offline: ReadonlyArray<string>) {
  return [
    ...online.map(name => ({ name, online: true })),
    ...offline.map(name => ({ name, online: false })),
  ].map((user, i): MentionableUser => ({ ...user, id: makeSbUserId(i + 1) }))
}

function suggestedNames(
  users: ReadonlyArray<MentionableUser>,
  text: string,
  baseUsers?: ReadonlyArray<MentionableUser>,
): string[] {
  const match = createMentionProvider(users, baseUsers).match(text)
  return ((match?.suggestions ?? []) as ReadonlyArray<TypeaheadSuggestion>).map(s => s.text)
}

// Every name but `zzz` fuzzily matches `t.t1`, and there are more of them than the palette shows.
const crowdedUsers = makeUsers(
  [
    'Artatack1301',
    'BSL-TT1',
    'IMTT1',
    'intact01',
    'IWANTTOBETT1',
    'JIRATT1',
    'matt1357',
    'matter1',
    'NOIAMTT1REAL',
    'Patate101',
    'zzz',
  ],
  ['T.T1'],
)

describe('messaging/mention-provider', () => {
  test('an exact match comes first even past the cap of fuzzy matches', () => {
    const names = suggestedNames(crowdedUsers, 'hi @T.T1')

    expect(names[0]).toBe('T.T1')
    expect(names).toHaveLength(MAX_MENTIONED_USERS)
  })

  test('an exact match ignores case', () => {
    expect(suggestedNames(crowdedUsers, '@t.t1')[0]).toBe('T.T1')
  })

  test('prefix matches beat substring matches beat fuzzy ones', () => {
    const users = makeUsers(['Artatack1301', 'IMTT1', 'tt1000'], ['TT1'])

    expect(suggestedNames(users, '@tt1')).toEqual(['TT1', 'tt1000', 'IMTT1', 'Artatack1301'])
  })

  test('online users come before offline ones among equally good matches', () => {
    const users = makeUsers(['JIRATT1'], ['BSL-TT1', 'IMTT1'])

    expect(suggestedNames(users, '@tt1')).toEqual(['JIRATT1', 'BSL-TT1', 'IMTT1'])
  })

  test('a bare @ offers the base users unchanged', () => {
    const base = makeUsers(['zzz', 'IMTT1'], [])

    expect(suggestedNames(crowdedUsers, '@', base)).toEqual(['zzz', 'IMTT1'])
  })
})
