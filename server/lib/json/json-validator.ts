import Joi from 'joi'

export const json = Joi.extend({
  type: 'object',
  base: Joi.object(),
  messages: {
    'json.invalid': 'The field {{#label}} is not a valid JSON',
  },
  coerce: {
    from: 'string',
    method: (value, helpers) => {
      try {
        const parsedValue = JSON.parse(value)
        return {
          value: parsedValue,
        }
      } catch (err) {
        return {
          errors: [helpers.error('json.invalid')],
        }
      }
    },
  },
})
