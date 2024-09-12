import Joi from 'joi'
import { json } from './json-validator.js'

describe('server/lib/json/json-validator', () => {
  test('throws an error if the root value is not a valid JSON', () => {
    const schema = json.object({
      test: Joi.string(),
    })

    expect(schema.validate('INVALID_JSON').error).toMatchInlineSnapshot(
      `[ValidationError: The field "value" is not valid JSON]`,
    )
  })

  test('throws an error if the property inside an object is not a valid JSON', () => {
    const schema = Joi.object({
      jsonObject: json.object({
        test: Joi.string(),
      }),
    })

    expect(schema.validate({ jsonObject: 'INVALID_JSON' }).error).toMatchInlineSnapshot(
      `[ValidationError: The field "jsonObject" is not valid JSON]`,
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
