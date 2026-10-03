import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { TitleId } from '../../common/titles'
import { useSelfUser } from '../auth/auth-utils'
import { listFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { ActionableNotification } from '../notifications/notifications'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { titleSmall } from '../styles/typography'
import { equipTitle, openTitlePicker } from './action-creators'
import { getTitleName } from './title-strings'

const titleListFormat = listFormat({ type: 'conjunction' })

const ColoredIcon = styledWithAttrs(MaterialIcon, { icon: 'military_tech', size: 36 })`
  flex-shrink: 0;
  color: var(--theme-amber);
`

const TitleNames = styled.span`
  ${titleSmall};
`

export interface TitleUnlockedNotificationUiProps {
  titleIds: ReadonlyArray<TitleId>
  showDivider: boolean
  read: boolean
  ref?: React.Ref<HTMLDivElement>
}

export function TitleUnlockedNotificationUi({
  titleIds,
  showDivider,
  read,
  ref,
}: TitleUnlockedNotificationUiProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const selfUser = useSelfUser()
  const names = useFormat(titleListFormat).format(
    titleIds.map(id => getTitleName(id, t, selfUser?.created)),
  )
  // Titles are recorded in display order, so the last of several unlocked together is the
  // highest tier.
  const newestTitle = titleIds.at(-1)

  return (
    <ActionableNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<ColoredIcon />}
      text={
        <span>
          {t('titles.notifications.unlocked', {
            defaultValue: 'New titles unlocked:',
            defaultValue_one: 'New title unlocked:',
            count: titleIds.length,
          })}{' '}
          <TitleNames>{names}</TitleNames>
        </span>
      }
      actions={
        titleIds.length === 1 && newestTitle
          ? [
              <TextButton
                key='equip'
                label={t('titles.notifications.equip', 'Equip')}
                onClick={() => {
                  dispatch(
                    equipTitle(newestTitle, {
                      onSuccess: () => {
                        snackbarController.showSnackbar(
                          t('titles.notifications.equipped', 'Title equipped'),
                        )
                      },
                      onError: () => {
                        snackbarController.showSnackbar(
                          t('titles.picker.saveError', 'There was a problem changing your title'),
                        )
                      },
                    }),
                  )
                }}
              />,
            ]
          : [
              <TextButton
                key='view'
                label={t('titles.notifications.viewAll', 'View all titles')}
                onClick={() => dispatch(openTitlePicker(newestTitle))}
              />,
            ]
      }
    />
  )
}

export interface TitlesIntroducedNotificationUiProps {
  count: number
  showDivider: boolean
  read: boolean
  ref?: React.Ref<HTMLDivElement>
}

export function TitlesIntroducedNotificationUi({
  count,
  showDivider,
  read,
  ref,
}: TitlesIntroducedNotificationUiProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  return (
    <ActionableNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<ColoredIcon />}
      text={t('titles.notifications.introduced', {
        defaultValue: "Titles are here! You've already unlocked {{number}} with your games so far.",
        defaultValue_one:
          "Titles are here! You've already unlocked {{number}} with your games so far.",
        count,
        number: count,
      })}
      actions={[
        <TextButton
          key='view'
          label={t('titles.notifications.viewAll', 'View all titles')}
          onClick={() => dispatch(openTitlePicker())}
        />,
      ]}
    />
  )
}
