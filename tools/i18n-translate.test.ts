// Fixtures intentionally use i18next plural keys (foo_one/foo_other), which aren't camelCase.
/* eslint-disable camelcase */
import fs from 'fs'
import path from 'path'
import { describe, expect, test } from 'vitest'
import {
  buildOrphans,
  buildPlan,
  compareKeys,
  deleteDeep,
  extractTokens,
  findSourcePluralBases,
  findStale,
  flatten,
  parseCsv,
  pluralCategoriesFor,
  serializeLocale,
  setDeep,
  splitPlural,
  tokensEqual,
} from './i18n-translate'

describe('compareKeys (i18next-parser-compatible sort)', () => {
  test('sorts case-insensitively, not by code unit', () => {
    // Real case from en/global.json: "reportedAPM" must come before "reportTitle".
    expect(compareKeys('reportedAPM', 'reportTitle')).toBeLessThan(0)
    expect(compareKeys('apple', 'Banana')).toBeLessThan(0)
  })

  test('orders plural variants of the same base by suffix position', () => {
    expect(compareKeys('userCount_one', 'userCount_other')).toBeLessThan(0)
    expect(compareKeys('userCount_other', 'userCount_one')).toBeGreaterThan(0)
    expect(compareKeys('userCount_few', 'userCount_many')).toBeLessThan(0)
  })

  test('compares by singular form, so a plural base sorts next to its siblings', () => {
    // "openSlotCount" vs "openSlotCount_one" share a singular form.
    expect(compareKeys('a', 'b')).toBeLessThan(0)
    expect(compareKeys('b', 'a')).toBeGreaterThan(0)
    expect(compareKeys('same', 'same')).toBe(0)
  })
})

describe('extractTokens / tokensEqual', () => {
  test('extracts interpolations and Trans tags, sorted', () => {
    expect(extractTokens('Hello {{name}}, see <2>{{email}}</2>')).toEqual([
      '</2>',
      '<2>',
      '{{email}}',
      '{{name}}',
    ])
    expect(extractTokens('no tokens here')).toEqual([])
  })

  test('tokensEqual is order-independent', () => {
    expect(tokensEqual('a {{x}} <1>y</1>', '<1>z</1> {{x}} b')).toBe(true)
  })

  test('tokensEqual catches a dropped or changed token', () => {
    expect(tokensEqual('{{count}} members', 'members')).toBe(false)
    expect(tokensEqual('{{a}}', '{{b}}')).toBe(false)
    expect(tokensEqual('<1>x</1>', '<2>x</2>')).toBe(false)
  })
})

describe('serializeLocale', () => {
  test('2-space indent, trailing newline, recursively sorted', () => {
    expect(serializeLocale({ b: '2', a: '1' })).toBe('{\n  "a": "1",\n  "b": "2"\n}\n')
  })

  test('sorts plural forms by suffix and bases case-insensitively', () => {
    const out = serializeLocale({
      x: { foo_other: 'o', foo_one: '1', bar: 'b' },
    })
    expect(out).toBe(
      '{\n  "x": {\n    "bar": "b",\n    "foo_one": "1",\n    "foo_other": "o"\n  }\n}\n',
    )
  })

  test('reproduces the committed en/global.json byte-for-byte (sort/format regression guard)', () => {
    const enPath = path.resolve(process.cwd(), 'server/public/locales/en/global.json')
    const current = fs.readFileSync(enPath, 'utf8').replace(/\r\n/g, '\n')
    expect(serializeLocale(JSON.parse(current))).toBe(current)
  })
})

describe('flatten / setDeep / deleteDeep', () => {
  test('flatten produces dotted keys', () => {
    expect([...flatten({ a: { b: '1', c: '2' }, d: '3' }).entries()]).toEqual([
      ['a.b', '1'],
      ['a.c', '2'],
      ['d', '3'],
    ])
  })

  test('setDeep creates nested objects', () => {
    const obj = {}
    setDeep(obj, 'a.b.c', 'x')
    expect(obj).toEqual({ a: { b: { c: 'x' } } })
  })

  test('deleteDeep removes a key and prunes emptied parents', () => {
    const obj = { a: { b: '1', c: '2' }, d: '3' }
    deleteDeep(obj, 'a.b')
    expect(obj).toEqual({ a: { c: '2' }, d: '3' })
    deleteDeep(obj, 'a.c')
    // `a` is now empty and should be removed entirely (no dangling `{}`).
    expect(obj).toEqual({ d: '3' })
  })
})

describe('plural helpers', () => {
  test('splitPlural only splits on a real plural suffix', () => {
    expect(splitPlural('foo_one')).toEqual({ base: 'foo', category: 'one' })
    expect(splitPlural('foo_other')).toEqual({ base: 'foo', category: 'other' })
    expect(splitPlural('foo')).toBeNull()
    // "phone" ends in "one" but not "_one" — must not be treated as plural.
    expect(splitPlural('phone')).toBeNull()
  })

  test('findSourcePluralBases needs both _one and _other', () => {
    const en = flatten({
      x: { foo_one: 'a', foo_other: 'b', bar: 'c' },
      lonely_other: 'd',
    })
    const bases = findSourcePluralBases(en)
    expect(bases.has('x.foo')).toBe(true)
    expect(bases.has('lonely')).toBe(false)
    expect(bases.has('x.bar')).toBe(false)
  })

  test('pluralCategoriesFor matches CLDR per language', () => {
    expect(pluralCategoriesFor('en')).toEqual(['one', 'other'])
    expect(pluralCategoriesFor('ko')).toEqual(['other'])
    expect(pluralCategoriesFor('zh-Hans')).toEqual(['other'])
    expect(pluralCategoriesFor('es')).toEqual(['one', 'many', 'other'])
    expect(pluralCategoriesFor('ru')).toEqual(['one', 'few', 'many', 'other'])
  })
})

describe('buildPlan (missing-key diff)', () => {
  const en = flatten({
    a: { b: 'Hello' },
    d: 'World',
    c: { userCount_one: '{{count}} member', userCount_other: '{{count}} members' },
  })

  test('finds missing single keys and incomplete plural groups', () => {
    const target = flatten({
      a: { b: 'Hola' },
      c: { userCount_one: 'un miembro' }, // missing many/other for es
    })
    const plan = buildPlan(en, target, 'es')
    expect(plan.pluralCategories).toEqual(['one', 'many', 'other'])

    const single = plan.items.find(i => i.key === 'd')
    expect(single).toEqual({ key: 'd', type: 'single', en: 'World' })

    const plural = plan.items.find(i => i.key === 'c.userCount')
    expect(plural).toMatchObject({
      key: 'c.userCount',
      type: 'plural',
      required: ['one', 'many', 'other'],
      en: { one: '{{count}} member', other: '{{count}} members' },
    })
  })

  test('reports nothing when the target is complete', () => {
    const target = flatten({
      a: { b: 'Hola' },
      d: 'Mundo',
      c: { userCount_one: 'a', userCount_many: 'b', userCount_other: 'c' },
    })
    expect(buildPlan(en, target, 'es').items).toEqual([])
  })
})

describe('buildOrphans', () => {
  test('flags keys absent from en and plural forms the language does not use', () => {
    const en = flatten({
      a: { b: 'Hello' },
      c: { userCount_one: '1', userCount_other: 'n' },
    })
    const target = flatten({
      a: { b: 'Hola' },
      x: { old: 'orphan' },
      c: { userCount_one: '1', userCount_two: 'dual' }, // _two not used by ru
    })
    expect(buildOrphans(en, target, 'ru')).toEqual(['c.userCount_two', 'x.old'])
  })
})

describe('findStale (English changed, translation did not)', () => {
  test('flags a single key whose English changed while the target stayed', () => {
    const enBase = flatten({ k: 'Old', p: 'Same' })
    const enNow = flatten({ k: 'New', p: 'Same' })
    const tgtBase = flatten({ k: 'Trad', p: 'P' })
    const tgtNow = flatten({ k: 'Trad', p: 'P' })
    expect(findStale(enBase, enNow, tgtBase, tgtNow, 'es')).toEqual([
      { key: 'k', type: 'single', enOld: 'Old', enNew: 'New', current: 'Trad' },
    ])
  })

  test('does not flag when the translation also changed, or when the key is newly added', () => {
    const enBase = flatten({ k: 'Old' })
    const enNow = flatten({ k: 'New', z: 'Added' })
    const tgtBase = flatten({ k: 'Trad' })
    const tgtNow = flatten({ k: 'TradNew', z: 'Nuevo' })
    expect(findStale(enBase, enNow, tgtBase, tgtNow, 'es')).toEqual([])
  })

  test('flags a plural group whose English changed', () => {
    const enBase = flatten({ c: { n_one: '{{count}} member', n_other: '{{count}} members' } })
    const enNow = flatten({ c: { n_one: '{{count}} member', n_other: '{{count}} users' } })
    const tgtBase = flatten({ c: { n_other: 'X' } })
    const tgtNow = flatten({ c: { n_other: 'X' } })
    const stale = findStale(enBase, enNow, tgtBase, tgtNow, 'ko')
    expect(stale).toHaveLength(1)
    expect(stale[0]).toMatchObject({
      key: 'c.n',
      type: 'plural',
      enNew: { other: '{{count}} users' },
      current: { other: 'X' },
    })
  })
})

describe('parseCsv (RFC-4180-ish)', () => {
  test('parses simple rows', () => {
    expect(parseCsv('source,target\nHello,Hola\n')).toEqual([
      ['source', 'target'],
      ['Hello', 'Hola'],
    ])
  })

  test('handles quoted fields with embedded commas, quotes, and newlines', () => {
    expect(parseCsv('a,b\n"x, y",z\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'z'],
    ])
    expect(parseCsv('a\n"she said ""hi"""\n')).toEqual([['a'], ['she said "hi"']])
    expect(parseCsv('a\n"line1\nline2"\n')).toEqual([['a'], ['line1\nline2']])
  })

  test('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
})
