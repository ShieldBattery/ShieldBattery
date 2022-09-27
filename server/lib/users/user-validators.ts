import Joi from 'joi'
import { USERNAME_MAXLENGTH, USERNAME_MINLENGTH, USERNAME_PATTERN } from '../../../common/constants'

export const joiUserId = () => Joi.number().min(1)

export const joiUsername = () =>
  Joi.string().min(USERNAME_MINLENGTH).max(USERNAME_MAXLENGTH).pattern(USERNAME_PATTERN)
