import { describe, expect, test } from 'vitest'
import { localizeLeague } from './league-translations'

const defaults = {
  name: 'Community League',
  description: 'Play ranked games together.',
  rulesAndInfo: '**Rules**\n\nPlay fair.',
}
const spanish = {
  language: 'es',
  name: 'Liga de la comunidad',
  description: 'Juega partidas clasificatorias.',
  rulesAndInfo: '**Reglas**\n\nJuega limpio.',
}

describe('league translations', () => {
  test('selects the preferred language without modifying the source', () => {
    const league = { ...defaults, translations: [spanish] }
    expect(localizeLeague(league, 'es')).toEqual({
      name: spanish.name,
      description: spanish.description,
      rulesAndInfo: spanish.rulesAndInfo,
    })
    expect(league.name).toBe(defaults.name)
  })

  test.each(['en', 'ko', 'fr'])('falls back to default text for %s', language => {
    expect(localizeLeague({ ...defaults, translations: [spanish] }, language)).toEqual(defaults)
  })

  test('supports leagues without translations', () => {
    expect(localizeLeague(defaults, 'es')).toEqual(defaults)
  })

  test('falls back independently for missing, empty, and whitespace-only fields', () => {
    expect(
      localizeLeague({ ...defaults, translations: [{ language: 'es', name: spanish.name }] }, 'es'),
    ).toEqual({ ...defaults, name: spanish.name })
    expect(
      localizeLeague(
        {
          ...defaults,
          translations: [{ language: 'es', name: ' ', description: '', rulesAndInfo: '\n' }],
        },
        'es',
      ),
    ).toEqual(defaults)
  })

  test('resolves regional locales and script tags using the app language rules', () => {
    expect(localizeLeague({ ...defaults, translations: [spanish] }, 'es-MX').name).toBe(
      spanish.name,
    )
    const chinese = { language: 'zh-Hans', name: '社区联赛' }
    expect(localizeLeague({ ...defaults, translations: [chinese] }, 'zh-CN').name).toBe(
      chinese.name,
    )
    expect(localizeLeague({ ...defaults, translations: [chinese] }, 'zh-TW').name).toBe(
      defaults.name,
    )
  })

  test('supports name-only data from badges and notifications', () => {
    expect(localizeLeague({ name: defaults.name, translations: [spanish] }, 'es').name).toBe(
      spanish.name,
    )
  })

  test('can add translated rules when the default has none, preserving markdown whitespace', () => {
    const rulesAndInfo = '  - Regla\n\n    código\n'
    expect(
      localizeLeague(
        { name: defaults.name, translations: [{ language: 'es', rulesAndInfo }] },
        'es',
      ).rulesAndInfo,
    ).toBe(rulesAndInfo)
  })
})
