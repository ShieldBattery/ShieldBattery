import { sql, sqlConcat, sqlRaw } from './sql'

describe('server/lib/db/sql', () => {
  test('basic usage', () => {
    const template = sql`SELECT * FROM users WHERE id = ${7}`
    expect(template.text).toMatchInlineSnapshot(`"SELECT * FROM users WHERE id = $1"`)
    expect(template.values).toEqual([7])
  })

  test('reuses value identifiers', () => {
    const ids = [7, 8, 9]
    const template = sql`SELECT * FROM users WHERE id = ANY(${ids}) OR other_id = ANY(${ids})`
    expect(template.text).toMatchInlineSnapshot(
      `"SELECT * FROM users WHERE id = ANY($1) OR other_id = ANY($1)"`,
    )
    expect(template.values).toEqual([ids])
  })

  test('reuses value identifiers across multiple templates', () => {
    const ids = [7, 8, 9]
    const template1 = sql`SELECT * FROM users WHERE id = ANY(${ids})`
    const template2 = template1.append(sql` OR other_id = ANY(${ids})`)
    expect(template2.text).toMatchInlineSnapshot(
      `"SELECT * FROM users WHERE id = ANY($1) OR other_id = ANY($1)"`,
    )
    expect(template2.values).toEqual([ids])
  })

  test('passes raw fragments directly', () => {
    const template = sql`SELECT ${sqlRaw('*')} FROM ${sqlRaw('users')}`
    expect(template.text).toMatchInlineSnapshot(`"SELECT * FROM users"`)
    expect(template.values).toEqual([])
  })

  test('concatenates multiple templates', () => {
    const template1 = sql`SELECT * FROM USERS WHERE `
    const template2 = template1.append(
      sqlConcat(' AND ', [
        sql`id = ${7}`,
        sql`name = ${'test'}`,
        sql`email = ${'foo@example.org'}`,
      ]),
    )

    expect(template2.text).toMatchInlineSnapshot(
      `"SELECT * FROM USERS WHERE id = $1 AND name = $2 AND email = $3"`,
    )
    expect(template2.values).toEqual([7, 'test', 'foo@example.org'])
  })

  test('concatenates a single template', () => {
    const template1 = sql`SELECT * FROM USERS WHERE `
    const template2 = template1.append(sqlConcat(' AND ', [sql`id = ${7}`]))

    expect(template2.text).toMatchInlineSnapshot(`"SELECT * FROM USERS WHERE id = $1"`)
    expect(template2.values).toEqual([7])
  })
})
