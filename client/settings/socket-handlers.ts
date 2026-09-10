import type { NydusClient, RouteInfo } from 'nydus-client'
import { AccountSettingsEvent } from '../../common/settings/account-settings'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { dispatch } from '../dispatch-registry'
import { writeCachedAccountSettings } from './account-settings-cache'

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute(
    '/account-settings/:userId',
    (route: RouteInfo, event: AccountSettingsEvent) => {
      if (event.action !== 'update') {
        return
      }

      const userId = makeSbUserId(Number(route.params.userId))
      dispatch({
        type: '@settings/updateAccountSettings',
        payload: event.settings,
      })
      writeCachedAccountSettings(userId, event.settings)
    },
  )
}
