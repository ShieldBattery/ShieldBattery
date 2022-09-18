import { escapeSearchString } from './escape-search-string'

describe('server/lib/db/escapeSearchString', () => {
  test('string without special characters', () => {
    expect(escapeSearchString('test')).toMatchInlineSnapshot(`"test"`)
  })

  test('string with underscore character', () => {
    expect(escapeSearchString('te_st')).toMatchInlineSnapshot(`"te\\_st"`)
  })

  test('string with percentage sign character', () => {
    expect(escapeSearchString('te%st')).toMatchInlineSnapshot(`"te\\%st"`)
  })

  test('string with backslash character', () => {
    expect(escapeSearchString('te\\st')).toMatchInlineSnapshot(`"te\\\\st"`)
  })
})
