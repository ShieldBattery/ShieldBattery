import Joi from 'joi'
import {
  CreateChannelInviteLinkRequest,
  INVITE_LINK_EXPIRY_OPTIONS_SECONDS,
  INVITE_LINK_MAX_USES_OPTIONS,
} from '../../../common/chat'

/**
 * The body of a request to get an invite link. Only the settings the client offers are accepted,
 * so nobody can make a link that lasts longer or admits more people than the offered choices allow.
 * A request without a body gets the default settings.
 */
export const createInviteLinkBodySchema = () =>
  Joi.object<CreateChannelInviteLinkRequest>({
    expiresInSeconds: Joi.number()
      .valid(...INVITE_LINK_EXPIRY_OPTIONS_SECONDS)
      .allow(null),
    maxUses: Joi.number()
      .valid(...INVITE_LINK_MAX_USES_OPTIONS)
      .allow(null),
  }).default({})
