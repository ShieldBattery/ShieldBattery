import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import {
  AccountSettingsResponse,
  ALL_CHAT_DISPLAY_MODES,
  UpdateAccountSettingsRequest,
} from '../../../common/settings/account-settings'
import {
  ALL_USER_AVAILABILITIES,
  MAX_STATUS_MESSAGE_LENGTH,
} from '../../../common/users/availability'
import { RestrictionKind } from '../../../common/users/restrictions'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpPost } from '../http/route-decorators'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUser } from '../throttle/middleware'
import { RestrictionService } from '../users/restriction-service'
import { validateRequest } from '../validation/joi-validator'
import { AccountSettingsService } from './account-settings-service'

const accountSettingsThrottle = createThrottle('accountsettings', {
  rate: 10,
  burst: 30,
  window: 60000,
})

/** Every `AccountSettings` key needs a rule here; unknown keys are rejected. */
export const updateAccountSettingsSchema = Joi.object<UpdateAccountSettingsRequest>({
  quietChannelsWhileInGame: Joi.boolean(),
  quietWhispersWhileInGame: Joi.boolean(),
  showWhispersEverywhere: Joi.boolean(),
  availability: Joi.valid(...ALL_USER_AVAILABILITIES),
  statusMessage: Joi.string()
    .trim()
    .max(MAX_STATUS_MESSAGE_LENGTH)
    .pattern(/^[^\r\n]*$/)
    .allow(''),
  chatDisplayMode: Joi.valid(...ALL_CHAT_DISPLAY_MODES),
})
  .min(1)
  .required()

@httpApi('/account-settings')
@httpBeforeAll(ensureLoggedIn)
export class AccountSettingsApi {
  constructor(
    private accountSettingsService: AccountSettingsService,
    private restrictionService: RestrictionService,
  ) {}

  @httpPost('/')
  @httpBefore(throttleMiddleware(accountSettingsThrottle, throttleByUser))
  async updateSettings(ctx: RouterContext): Promise<AccountSettingsResponse> {
    const { body } = validateRequest(ctx, {
      body: updateAccountSettingsSchema,
    })
    const userId = ctx.session!.user.id

    // A status message is text shown to other users, so chat restrictions cover it.
    if (
      body.statusMessage &&
      (await this.restrictionService.isRestricted(userId, RestrictionKind.Chat))
    ) {
      throw new httpErrors.Forbidden('Chat restricted users cannot set a status message')
    }

    const settings = await this.accountSettingsService.updateSettings(userId, body)
    return { settings }
  }
}
