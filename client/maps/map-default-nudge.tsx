import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { filterColorCodes, SbMapId } from '../../common/maps'
import { graphql } from '../gql'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { Tooltip } from '../material/tooltip'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodySmall } from '../styles/typography'
import { getMapInfo } from './action-creators'

const MapDefaultNudgeQuery = graphql(/* GraphQL */ `
  query MapDefaultNudge($id: SbMapId!) {
    map(id: $id) {
      id
      family {
        id
        current {
          id
          name
          listed
        }
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
  padding-top: 4px;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 4px;
`

const NudgeIcon = styled(MaterialIcon).attrs({ icon: 'info', size: 16 })`
  flex-shrink: 0;
  color: var(--color-amber80);
`

const NudgeText = styled.div`
  ${bodySmall};
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--theme-on-surface);
`

const SwitchButton = styled(TextButton)`
  min-width: 0;
  padding-inline: 8px;
`

/**
 * A line telling a lobby's host that the chosen file isn't the one players get when they pick its
 * map, with an action to switch to that one. Not a prompt: hosts sometimes want a particular file on
 * purpose (a rematch, a replay study), so it stays out of the way.
 */
export function MapDefaultNudge({
  mapId,
  disabled,
  onSwitch,
}: {
  mapId: SbMapId
  disabled?: boolean
  /** Called with the default file's id once its info is in the store. */
  onSwitch: (mapId: SbMapId) => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const [switching, setSwitching] = useState(false)
  const [{ data }] = useQuery({
    query: MapDefaultNudgeQuery,
    variables: { id: mapId },
    context: NO_SUSPENSE_CONTEXT,
  })

  const family = data?.map?.id === mapId ? data.map.family : undefined
  const current = family?.current
  if (!family || !current || !current.listed || current.id === mapId) {
    return null
  }

  const currentName = filterColorCodes(current.name)
  const onClick = () => {
    setSwitching(true)
    // The lobby's setup reads the chosen map's info from the store, so it has to be there first
    dispatch(
      getMapInfo(current.id, {
        onSuccess: () => {
          setSwitching(false)
          onSwitch(current.id)
        },
        onError: () => {
          setSwitching(false)
          snackbarController.showSnackbar(
            t('maps.nudge.switchError', "Couldn't load the default file"),
          )
        },
      }),
    )
  }

  return (
    <Root>
      <NudgeIcon />
      <NudgeText>{t('maps.files.notDefault', 'Not the default file')}</NudgeText>
      <Tooltip text={currentName} position='bottom' tabIndex={-1}>
        <SwitchButton
          label={t('maps.nudge.useDefault', 'Use default')}
          disabled={disabled || switching}
          onClick={onClick}
        />
      </Tooltip>
    </Root>
  )
}
