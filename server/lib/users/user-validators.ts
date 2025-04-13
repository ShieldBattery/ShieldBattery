import Joi from 'joi'
import {
  EMAIL_MAXLENGTH,
  EMAIL_MINLENGTH,
  EMAIL_PATTERN,
  USERNAME_MAXLENGTH,
  USERNAME_MINLENGTH,
  USERNAME_PATTERN,
} from '../../../common/constants'

export const joiUserId = () => Joi.number().min(1)

export const joiUsername = () =>
  Joi.string().min(USERNAME_MINLENGTH).max(USERNAME_MAXLENGTH).pattern(USERNAME_PATTERN)

export const joiEmail = () =>
  Joi.string().min(EMAIL_MINLENGTH).max(EMAIL_MAXLENGTH).pattern(EMAIL_PATTERN)
