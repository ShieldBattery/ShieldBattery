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
import { bodySmall } from '../styles/typography'
import { getMapInfo } from './action-creators'

const MapDefaultNudgeQuery = graphql(/* GraphQL */ `
  query MapDefaultNudge($id: SbMapId!) {
    map(id: $id) {
      id
      family {
        id
        name
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
  flex-direction: column;
  align-items: flex-start;
`

const Message = styled.div`
  min-width: 0;

  display: flex;
  align-items: flex-start;
  gap: 4px;
`

const NudgeIcon = styled(MaterialIcon).attrs({ icon: 'info', size: 16 })`
  flex-shrink: 0;
  /* Centers the icon on the text's first line. */
  margin-top: 2px;
  color: var(--color-amber80);
`

const SwitchButton = styled(TextButton)`
  /* Lines the label up with the message, past the button's own padding. */
  margin-left: 8px;
`

const NudgeText = styled.div`
  ${bodySmall};
  min-width: 0;
  color: var(--theme-on-surface);
  overflow-wrap: anywhere;
`

/**
 * A line telling a lobby's host that the chosen file isn't the one players get when they pick its
 * map, with a button to switch to that one. Not a prompt: hosts sometimes want a particular file on
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

  const mapName = filterColorCodes(family.name)
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
      <Message>
        <NudgeIcon />
        <NudgeText>
          {currentName === mapName
            ? t('maps.nudge.notDefaultFor', {
                defaultValue: "This isn't the default file for {{map}}.",
                map: mapName,
              })
            : t('maps.nudge.notDefaultForUseFile', {
                defaultValue: "This isn't the default file for {{map}}. Use {{file}}?",
                map: mapName,
                file: currentName,
              })}
        </NudgeText>
      </Message>
      <SwitchButton
        label={t('maps.nudge.useDefault', 'Use default')}
        disabled={disabled || switching}
        onClick={onClick}
      />
    </Root>
  )
}
