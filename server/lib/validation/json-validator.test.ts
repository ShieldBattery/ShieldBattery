import Joi from 'joi'
import { json } from './json-validator'

describe('server/lib/json/json-validator', () => {
  test('throws an error if the property is not a valid JSON', () => {
    const schema = json.object({
      test: Joi.string(),
    })

    expect(schema.validate('INVALID_JSON').error).toMatchInlineSnapshot(
      `[ValidationError: The field "value" is not a valid JSON]`,
    )
  })

  test('parses the schema with a JSON string property', () => {
    const schema = json.object({
      string: Joi.string(),
      array: Joi.array(),
      object: Joi.object(),
      number: Joi.number(),
      boolean: Joi.boolean(),
    })

    const body = {
      string: 'STRING',
      array: ['a', 'b', 'c'],
      object: { a: 'a', b: 'b', c: 'c' },
      number: 1,
      boolean: true,
    }

    expect(schema.validate(JSON.stringify(body)).value).toEqual(body)
  })
})
