import Joi from 'joi'

export const joiLocale = () => Joi.string().max(35).allow('')
