import { RouterContext } from '@koa/router'
import Joi from 'joi'
import { MAX_REPLAY_NAME_TEMPLATE_LENGTH } from '../../../common/replay-name-template'
import {
  AccountSettingsResponse,
  ALL_CHAT_DISPLAY_MODES,
  UpdateAccountSettingsRequest,
} from '../../../common/settings/account-settings'
import { ALL_USER_AVAILABILITIES } from '../../../common/users/availability'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpPost } from '../http/route-decorators'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUser } from '../throttle/middleware'
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
  playMessageSounds: Joi.boolean(),
  flashTaskbar: Joi.boolean(),
  showWhispersEverywhere: Joi.boolean(),
  availability: Joi.valid(...ALL_USER_AVAILABILITIES),
  chatDisplayMode: Joi.valid(...ALL_CHAT_DISPLAY_MODES),
  replayNameTemplate: Joi.string().allow('').max(MAX_REPLAY_NAME_TEMPLATE_LENGTH),
})
  .min(1)
  .required()

@httpApi('/account-settings')
@httpBeforeAll(ensureLoggedIn)
export class AccountSettingsApi {
  constructor(private accountSettingsService: AccountSettingsService) {}

  @httpPost('/')
  @httpBefore(throttleMiddleware(accountSettingsThrottle, throttleByUser))
  async updateSettings(ctx: RouterContext): Promise<AccountSettingsResponse> {
    const { body } = validateRequest(ctx, {
      body: updateAccountSettingsSchema,
    })
    const userId = ctx.session!.user.id

    const settings = await this.accountSettingsService.updateSettings(userId, body)
    return { settings }
  }
}
