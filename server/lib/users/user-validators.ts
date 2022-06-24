import Joi from 'joi'

export const joiUserId = () => Joi.number().min(1)
