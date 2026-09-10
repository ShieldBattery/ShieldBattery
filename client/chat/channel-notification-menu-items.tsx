import { TFunction } from 'i18next'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { assertUnreachable } from '../../common/assert-unreachable'
import {
  ALL_CHANNEL_NOTIFICATION_LEVELS,
  ChannelNotificationLevel,
  DEFAULT_CHANNEL_PREFERENCES,
  SbChannelId,
  UpdateChannelUserPreferencesRequest,
} from '../../common/chat'
import { CheckableMenuItem } from '../material/menu/checkable-item'
import { Divider } from '../material/menu/divider'
import { SelectableMenuItem } from '../material/menu/selectable-item'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { updateChannelUserPreferences } from './action-creators'

function notificationLevelText(level: ChannelNotificationLevel, t: TFunction): string {
  switch (level) {
    case ChannelNotificationLevel.All:
      return t('chat.notifications.level.all', 'Notify for all messages')
    case ChannelNotificationLevel.Mentions:
      return t('chat.notifications.level.mentions', 'Notify for mentions only')
    case ChannelNotificationLevel.Nothing:
      return t('chat.notifications.level.nothing', 'Never notify')
    default:
      return assertUnreachable(level)
  }
}

/**
 * Builds the menu items that control how a chat channel notifies the current user: a mute toggle,
 * then one item per notification level.
 *
 * These are returned as a flat array rather than wrapped in a component because `MenuList` reads
 * the menu items out of its own children, and anything that hides them inside another component
 * would be treated as decorative content instead. Spread the result into a `MenuList` (directly or
 * inside another array of items). `dense` only affects the divider between the mute toggle and the
 * levels, since `MenuList` passes its density down to the items itself.
 */
export function useChannelNotificationMenuItems(
  channelId: SbChannelId,
  onDismiss: () => void,
  { dense }: { dense?: boolean } = {},
): React.ReactNode[] {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const preferences =
    useAppSelector(s => s.chat.idToSelfPreferences.get(channelId)) ?? DEFAULT_CHANNEL_PREFERENCES

  const updatePreferences = (changes: UpdateChannelUserPreferencesRequest) => {
    onDismiss()
    dispatch(
      updateChannelUserPreferences(channelId, changes, {
        onSuccess: () => {},
        onError: () => {
          snackbarController.showSnackbar(
            t(
              'chat.notifications.errors.updateFailed',
              'Something went wrong updating the notification settings',
            ),
          )
        },
      }),
    )
  }

  return [
    <CheckableMenuItem
      key='mute-channel'
      checked={preferences.muted}
      text={t('chat.notifications.muteChannel', 'Mute channel')}
      onClick={() => updatePreferences({ muted: !preferences.muted })}
    />,
    <Divider key='notification-level-divider' $dense={dense} />,
    ...ALL_CHANNEL_NOTIFICATION_LEVELS.map(level => (
      <SelectableMenuItem
        key={level}
        selected={preferences.notificationLevel === level}
        text={notificationLevelText(level, t)}
        onClick={() => updatePreferences({ notificationLevel: level })}
      />
    )),
  ]
}
