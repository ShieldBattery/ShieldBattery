import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { styled } from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon.js'
import { IconButton } from '../material/button.js'
import { useAppDispatch, useAppSelector } from '../redux-hooks.js'
import { goBack } from './action-creators.js'

const BackButton = styled(IconButton)`
  margin-right: 16px;
`

export function ActivityBackButton() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const historySize = useAppSelector(s => s.activityOverlay.history.length)
  // We only check to see if the back button should display on the first render, and keep it from
  // then on. This assumes that the back stack cannot change without the ActivityOverlay content
  // changing, which seems to be an accurate assumption. By doing it this way, we prevent the
  // back button from disappearing during transitions (e.g. if you click off the overlay)
  const [shouldShow] = useState(historySize >= 2)
  const onBackClick = useCallback(() => {
    dispatch(goBack())
  }, [dispatch])

  return shouldShow ? (
    <BackButton
      icon={<MaterialIcon icon='arrow_back' />}
      title={t('common.actions.back', 'Back')}
      onClick={onBackClick}
    />
  ) : null
}
