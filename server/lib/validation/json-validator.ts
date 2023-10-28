import Joi from 'joi'

export const json = Joi.extend({
  type: 'object',
  base: Joi.object(),
  messages: {
    'json.invalid': 'The field {{#label}} is not valid JSON',
  },
  coerce: {
    from: 'string',
    method: (value, helpers) => {
      try {
        return {
          value: JSON.parse(value),
        }
      } catch (err) {
        return {
          errors: [helpers.error('json.invalid')],
        }
      }
    },
  },
})
