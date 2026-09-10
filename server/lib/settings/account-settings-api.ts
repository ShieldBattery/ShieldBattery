import { RouterContext } from '@koa/router'
import Joi from 'joi'
import {
  AccountSettingsResponse,
  UpdateAccountSettingsRequest,
} from '../../../common/settings/account-settings'
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

@httpApi('/account-settings')
@httpBeforeAll(ensureLoggedIn)
export class AccountSettingsApi {
  constructor(private accountSettingsService: AccountSettingsService) {}

  @httpPost('/')
  @httpBefore(throttleMiddleware(accountSettingsThrottle, throttleByUser))
  async updateSettings(ctx: RouterContext): Promise<AccountSettingsResponse> {
    const { body } = validateRequest(ctx, {
      // Every `AccountSettings` key needs a rule here; unknown keys are rejected.
      body: Joi.object<UpdateAccountSettingsRequest>({
        quietWhileInGame: Joi.boolean(),
      })
        .min(1)
        .required(),
    })

    const settings = await this.accountSettingsService.updateSettings(ctx.session!.user.id, body)
    return { settings }
  }
}
