import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { filterColorCodes, SbMapId } from '../../common/maps'
import { graphql } from '../gql'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodySmall, singleLine } from '../styles/typography'
import { getMapInfo } from './action-creators'

const MapNewerVersionQuery = graphql(/* GraphQL */ `
  query MapNewerVersionNudge($id: SbMapId!) {
    map(id: $id) {
      id
      newerVersion {
        id
        name
      }
    }
  }
`)

/**
 * Requests results without suspending: the nudge shows nothing until it knows. Module-level so the
 * query sees the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const Root = styled.div`
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 4px;
`

const NudgeIcon = styled(MaterialIcon).attrs({ icon: 'history', size: 16 })`
  flex-shrink: 0;
  color: var(--color-amber80);
`

const NudgeText = styled.div`
  ${bodySmall};
  ${singleLine};
  min-width: 0;
  color: var(--theme-on-surface);
`

/**
 * A line telling a lobby's host that a newer version of the chosen map exists, with a button to
 * switch to it. Not a prompt: hosts sometimes want an older version on purpose (a rematch, a
 * replay study), so it stays out of the way.
 */
export function MapNewerVersionNudge({
  mapId,
  disabled,
  onSwitch,
}: {
  mapId: SbMapId
  disabled?: boolean
  /** Called with the newer version's id once its info is in the store. */
  onSwitch: (mapId: SbMapId) => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const [switching, setSwitching] = useState(false)
  const [{ data }] = useQuery({
    query: MapNewerVersionQuery,
    variables: { id: mapId },
    context: NO_SUSPENSE_CONTEXT,
  })

  const newer = data?.map?.newerVersion
  if (!newer) {
    return null
  }

  const name = filterColorCodes(newer.name)
  const onClick = () => {
    setSwitching(true)
    // The lobby's setup reads the chosen map's info from the store, so it has to be there first
    dispatch(
      getMapInfo(newer.id, {
        onSuccess: () => {
          setSwitching(false)
          onSwitch(newer.id)
        },
        onError: () => {
          setSwitching(false)
          snackbarController.showSnackbar(
            t('maps.nudge.switchError', "Couldn't load the newer version"),
          )
        },
      }),
    )
  }

  return (
    <Root>
      <NudgeIcon />
      <NudgeText title={name}>
        {t('maps.nudge.newerAvailable', {
          defaultValue: '{{name}} is available',
          name,
        })}
      </NudgeText>
      <TextButton
        label={t('maps.nudge.switch', 'Switch')}
        disabled={disabled || switching}
        onClick={onClick}
      />
    </Root>
  )
}
