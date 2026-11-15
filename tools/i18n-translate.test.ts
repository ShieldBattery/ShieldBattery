// Fixtures intentionally use i18next plural keys (foo_one/foo_other), which aren't camelCase.
/* eslint-disable eslint-core/camelcase */
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, test } from 'vitest'
import {
  buildOrphans,
  buildPlan,
  collectShowEntries,
  compareKeys,
  deleteDeep,
  enReferenceForCategory,
  extractTokens,
  findSourcePluralBases,
  findStale,
  flatten,
  localeExistsAtRef,
  mergePlans,
  parseCsv,
  planRename,
  pluralCategoriesFor,
  resolveStaleBase,
  serializeLocale,
  setDeep,
  splitByLanguage,
  splitPlural,
  tokensEqual,
} from './i18n-translate'

describe('compareKeys (i18next-cli-compatible sort)', () => {
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

describe('enReferenceForCategory', () => {
  // English with divergent tokens between the one and other forms.
  const enOne = 'a member'
  const enOther = '{{count}} members'

  test('one validates against en.one; other plural categories against en.other', () => {
    expect(enReferenceForCategory('one', enOne, enOther)).toBe('a member')
    expect(enReferenceForCategory('other', enOne, enOther)).toBe('{{count}} members')
    expect(enReferenceForCategory('few', enOne, enOther)).toBe('{{count}} members')
    expect(enReferenceForCategory('many', enOne, enOther)).toBe('{{count}} members')
  })

  test('falls back to whichever form exists', () => {
    expect(enReferenceForCategory('one', undefined, enOther)).toBe('{{count}} members')
    expect(enReferenceForCategory('other', enOne, undefined)).toBe('a member')
    expect(enReferenceForCategory('one', undefined, undefined)).toBe('')
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

describe('collectShowEntries', () => {
  const locales = new Map([
    [
      'en',
      flatten({
        chat: {
          block: 'Block',
          userCount_one: '{{count}} member',
          userCount_other: '{{count}} members',
        },
        lobby: { start: 'Start' },
      }),
    ],
    [
      'es',
      flatten({
        chat: { block: 'Bloquear', userCount_one: 'un miembro', userCount_other: 'miembros' },
        old: { gone: 'Hola' },
      }),
    ],
  ])

  test('selects an exact key, a subtree, and groups plural forms into one entry', () => {
    const { entries, unmatched } = collectShowEntries(locales, ['chat'], undefined)
    expect(unmatched).toEqual([])
    expect(entries.map(e => e.key)).toEqual(['chat.block', 'chat.userCount'])
    const plural = entries[1]
    expect(plural.plural).toBe(true)
    expect(plural.values.get('es')).toEqual({ one: 'un miembro', other: 'miembros' })

    expect(collectShowEntries(locales, ['lobby.start'], undefined).entries).toHaveLength(1)
    // A dotted prefix matches whole path segments only.
    expect(collectShowEntries(locales, ['cha'], undefined).entries).toEqual([])
  })

  test('reports prefixes that match nothing', () => {
    expect(collectShowEntries(locales, ['chat', 'nope.'], undefined).unmatched).toEqual(['nope'])
  })

  test('grep matches a value in any language, including keys only a target has', () => {
    const byEnglish = collectShowEntries(locales, [], /^block$/i).entries
    expect(byEnglish.map(e => e.key)).toEqual(['chat.block'])
    const byTarget = collectShowEntries(locales, [], /hola/i).entries
    expect(byTarget.map(e => e.key)).toEqual(['old.gone'])
    expect(byTarget[0].values.has('en')).toBe(false)
  })

  test('grep narrows a prefix selection', () => {
    const { entries } = collectShowEntries(locales, ['chat'], /miembro/)
    expect(entries.map(e => e.key)).toEqual(['chat.userCount'])
  })
})

describe('mergePlans', () => {
  const en = flatten({
    a: 'Hello',
    c: { n_one: '{{count}} member', n_other: '{{count}} members' },
  })

  test('lists each key once with the languages missing it and per-language plural forms', () => {
    const es = buildPlan(en, flatten({ a: 'Hola' }), 'es')
    const ko = buildPlan(en, flatten({}), 'ko')
    const merged = mergePlans([es, ko])
    expect(merged.languages).toEqual(['es', 'ko'])
    expect(merged.items).toEqual([
      { key: 'a', type: 'single', en: 'Hello', missing: ['ko'] },
      {
        key: 'c.n',
        type: 'plural',
        en: { one: '{{count}} member', other: '{{count}} members' },
        missing: ['es', 'ko'],
        required: { es: ['one', 'many', 'other'], ko: ['other'] },
      },
    ])
  })
})

describe('splitByLanguage', () => {
  test('buckets values per language, allowing a key to list only some languages', () => {
    const { byLang, errors } = splitByLanguage(
      { a: { es: 'Hola' }, 'c.n': { es: { one: 'x', other: 'y' }, ko: { other: 'z' } } },
      ['es', 'ko'],
    )
    expect(errors).toEqual([])
    expect(byLang.get('es')).toEqual({ a: 'Hola', 'c.n': { one: 'x', other: 'y' } })
    expect(byLang.get('ko')).toEqual({ 'c.n': { other: 'z' } })
  })

  test('rejects unknown languages and values not keyed by language', () => {
    const { errors } = splitByLanguage({ a: { fr: 'Salut' }, b: 'Hola' }, ['es'])
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('unknown language "fr"')
    expect(errors[1]).toContain('expected an object keyed by language')
  })
})

describe('planRename', () => {
  test('moves a leaf, a subtree and plural forms, keeping the suffix', () => {
    const flat = flatten({ a: { b: '1', c: { d: '2' }, n_one: 'x', n_other: 'y' }, z: '3' })
    expect(planRename(flat, 'a.c', 'q.c')).toEqual({ moves: [['a.c.d', 'q.c.d']], conflicts: [] })
    expect(planRename(flat, 'a.n', 'a.m').moves).toEqual([
      ['a.n_one', 'a.m_one'],
      ['a.n_other', 'a.m_other'],
    ])
    expect(planRename(flat, 'a', 'x').moves).toHaveLength(4)
    // "a.b" must not drag along "a.bb".
    expect(planRename(flatten({ 'a.bb': '1' }), 'a.b', 'x').moves).toEqual([])
  })

  test('reports destinations that already exist, as a leaf or as a subtree', () => {
    const flat = flatten({ a: { b: '1' }, x: { y: '2' }, w: '3' })
    expect(planRename(flat, 'a.b', 'x.y').conflicts).toEqual(['x.y'])
    expect(planRename(flat, 'a.b', 'x').conflicts).toEqual(['x'])
    expect(planRename(flat, 'a.b', 'w.v').conflicts).toEqual(['w.v'])
  })

  test('does not treat the keys being moved as conflicts', () => {
    const flat = flatten({ a: { b: '1' } })
    expect(planRename(flat, 'a', 'a.inner').conflicts).toEqual([])
  })
})

describe('stale base selection (git)', () => {
  const runGit = (cwd: string, ...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.com',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd, encoding: 'utf8' },
    ).trim()

  function commitFiles(cwd: string, files: Record<string, string>, message: string): string {
    for (const [rel, content] of Object.entries(files)) {
      const file = path.join(cwd, rel)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, content)
    }
    runGit(cwd, 'add', '-A')
    runGit(cwd, 'commit', '-q', '-m', message)
    return runGit(cwd, 'rev-parse', 'HEAD')
  }

  function withRepo(fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-stale-'))
    try {
      runGit(dir, 'init', '-q', '-b', 'master')
      fn(dir)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  const locale = (lang: string) => `server/public/locales/${lang}/global.json`

  test('uses the last commit touching the language file when it predates the merge-base', () => {
    withRepo(dir => {
      const first = commitFiles(
        dir,
        { [locale('en')]: '{"a":"One"}', [locale('es')]: '{"a":"Uno"}', 'README.md': 'x' },
        'locales',
      )
      commitFiles(dir, { [locale('en')]: '{"a":"Uno!"}' }, 'reword english')
      const head = commitFiles(dir, { 'README.md': 'y' }, 'unrelated')

      // On master the merge-base is HEAD; es was last touched at the first commit.
      expect(resolveStaleBase('es', undefined, dir)).toEqual({
        ref: first,
        reason: 'last es change',
      })
      // A language whose file was never committed falls back to the merge-base.
      expect(resolveStaleBase('ko', undefined, dir)).toEqual({ ref: head, reason: 'merge-base' })
      expect(resolveStaleBase('es', first, dir)).toEqual({ ref: first, reason: '--since' })
    })
  })

  test('uses the merge-base when the language file changed on the branch', () => {
    withRepo(dir => {
      const base = commitFiles(
        dir,
        { [locale('en')]: '{"a":"One"}', [locale('es')]: '{"a":"Uno"}' },
        'locales',
      )
      runGit(dir, 'checkout', '-q', '-b', 'feature')
      commitFiles(dir, { [locale('es')]: '{"a":"Una"}' }, 'retranslate')
      expect(resolveStaleBase('es', undefined, dir)).toEqual({ ref: base, reason: 'merge-base' })
    })
  })

  test('localeExistsAtRef is false for a ref before the file existed', () => {
    withRepo(dir => {
      const before = commitFiles(dir, { 'README.md': 'x' }, 'readme')
      const after = commitFiles(dir, { [locale('en')]: '{"a":"One"}' }, 'locales')
      expect(localeExistsAtRef('en', before, dir)).toBe(false)
      expect(localeExistsAtRef('en', after, dir)).toBe(true)
    })
  })
})
