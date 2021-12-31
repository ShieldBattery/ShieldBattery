import Joi from 'joi'

export function joiClientIdentifiers() {
  return Joi.array()
    .items(
      Joi.array().ordered(
        Joi.number().min(0).max(7).required(),
        Joi.string().min(0).max(64).required(),
      ),
    )
    .min(1)
}
