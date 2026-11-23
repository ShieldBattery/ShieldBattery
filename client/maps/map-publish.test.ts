import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { PublishEvidence, publishEvidenceText } from './map-publish'

/** Returns each string's default text with its `{{placeholders}}` filled in. */
const t = ((_key: string, defaultValue: string, options?: Record<string, unknown>) =>
  defaultValue.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    String(options?.[name] ?? ''),
  )) as unknown as TFunction

function evidence(overrides: Partial<PublishEvidence> = {}): PublishEvidence {
  return {
    similarity: 0.9,
    sameKind: true,
    triggerSimilarity: null,
    sameResources: false,
    ...overrides,
  }
}

describe('maps/map-publish/publishEvidenceText', () => {
  test('calls nearly identical terrain the same', () => {
    expect(publishEvidenceText(evidence({ similarity: 1 }), t)).toBe('same terrain')
    expect(publishEvidenceText(evidence({ similarity: 0.995 }), t)).toBe('same terrain')
  })

  test('rounds the terrain share down', () => {
    expect(publishEvidenceText(evidence({ similarity: 0.994 }), t)).toBe('99% same terrain')
    expect(publishEvidenceText(evidence({ similarity: 0.876 }), t)).toBe('87% same terrain')
  })

  test("isn't thrown off by floating point error", () => {
    expect(publishEvidenceText(evidence({ similarity: 0.29 }), t)).toBe('29% same terrain')
  })

  test('adds same resources and a different game type', () => {
    expect(publishEvidenceText(evidence({ sameResources: true }), t)).toBe(
      '90% same terrain · same resources',
    )
    expect(publishEvidenceText(evidence({ sameKind: false }), t)).toBe(
      '90% same terrain · different game type',
    )
    expect(
      publishEvidenceText(evidence({ similarity: 1, sameResources: true, sameKind: false }), t),
    ).toBe('same terrain · same resources · different game type')
  })

  test('mentions triggers only when they clearly match or differ', () => {
    expect(publishEvidenceText(evidence({ triggerSimilarity: 0.9 }), t)).toBe(
      '90% same terrain · same triggers',
    )
    expect(publishEvidenceText(evidence({ triggerSimilarity: 0.49 }), t)).toBe(
      '90% same terrain · different triggers',
    )
    expect(publishEvidenceText(evidence({ triggerSimilarity: 0.5 }), t)).toBe('90% same terrain')
    expect(publishEvidenceText(evidence({ triggerSimilarity: 0.89 }), t)).toBe('90% same terrain')
    expect(publishEvidenceText(evidence({ triggerSimilarity: 0 }), t)).toBe(
      '90% same terrain · different triggers',
    )
  })

  test('puts triggers last', () => {
    expect(
      publishEvidenceText(
        evidence({ similarity: 1, sameResources: true, triggerSimilarity: 1 }),
        t,
      ),
    ).toBe('same terrain · same resources · same triggers')
  })
})
