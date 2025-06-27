import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MapVisibility, tilesetToName } from '../../common/maps'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import { required } from '../forms/validators'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { useAutoFocusRef } from '../material/auto-focus'
import { IconButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import LoadingIndicator from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { bodyLarge, bodyMedium, headlineMedium, singleLine } from '../styles/typography'
import { getMapDetails, updateMap } from './action-creators'
import { MapThumbnail } from './map-thumbnail'

const ESCAPE = 'Escape'

const Container = styled.div`
  display: flex;
  align-items: flex-start;
`

const LoadingArea = styled.div`
  display: flex;
  justify-content: center;
  margin-top: 24px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

const MapInfo = styled.div`
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  min-height: 220px;
  margin-right: 16px;
`

const MapName = styled.div<{ $canEdit?: boolean }>`
  ${headlineMedium};
  flex-shrink: 0;
  position: relative;
  max-width: calc(768px - 48px - 16px - 220px);
  margin: 0;
  margin-bottom: 16px;
  padding-right: ${props => (props.$canEdit ? '68px' : '16px')};
  line-height: 48px;
  letter-spacing: 0.25px;
  user-select: text;
  ${singleLine};
`

const MapDescriptionWrapper = styled.div`
  height: 120px;
  overflow-y: auto;
`

const MapDescription = styled.div<{ $canEdit?: boolean }>`
  ${bodyLarge};
  position: relative;
  margin: 0;
  padding-right: ${props => (props.$canEdit ? '68px' : '16px')};
  white-space: pre-wrap;
  overflow-wrap: break-word;
  user-select: text;
`

const EditButton = styled(IconButton)`
  position: absolute;
  top: 0;
  right: 16px;
`

const MapData = styled.div`
  display: flex;
  justify-content: space-between;
  margin-top: 16px;
`

const MapDataItem = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const StyledMapThumbnail = styled(MapThumbnail)`
  flex-shrink: 0;
  width: 220px;
  height: 220px;
`

interface NameFormProps {
  initialName: string
  onSubmit: (model: { name: string }) => void
  onCancel: () => void
}

function NameForm({ initialName, onSubmit, onCancel }: NameFormProps) {
  const { t } = useTranslation()
  const autoFocusRef = useAutoFocusRef<HTMLInputElement>()
  const { bindInput, submit, form } = useForm<{ name: string }>(
    { name: initialName },
    {
      name: required(t('maps.details.mapNameRequired', 'Enter a map name')),
    },
  )

  useFormCallbacks(form, {
    onSubmit,
  })

  const trailingIcons = [
    <IconButton
      icon={<MaterialIcon icon='check' />}
      title={t('common.actions.save', 'Save')}
      onClick={submit}
      key='save'
    />,
    <IconButton
      icon={<MaterialIcon icon='close' />}
      title={t('common.actions.cancel', 'Cancel')}
      onClick={onCancel}
      key='cancel'
    />,
  ]

  useKeyListener({
    onKeyDown: event => {
      if (event.code === ESCAPE) {
        onCancel()
        return true
      }

      return false
    },
  })

  return (
    <form noValidate={true} onSubmit={submit}>
      <SubmitOnEnter />
      <TextField
        {...bindInput('name')}
        ref={autoFocusRef}
        label={t('maps.details.mapName', 'Map name')}
        trailingIcons={trailingIcons}
      />
    </form>
  )
}

interface DescriptionFormProps {
  initialDescription: string
  onSubmit: (model: { description: string }) => void
  onCancel: () => void
}

function DescriptionForm({ initialDescription, onSubmit, onCancel }: DescriptionFormProps) {
  const { t } = useTranslation()
  const autoFocusRef = useAutoFocusRef<HTMLInputElement>()
  const { bindInput, submit, form } = useForm<{ description: string }>(
    { description: initialDescription },
    {
      description: required(t('maps.details.mapDescriptionRequired', 'Enter a map description')),
    },
  )

  const trailingIcons = [
    <IconButton
      icon={<MaterialIcon icon='check' />}
      title={t('common.actions.save', 'Save')}
      onClick={submit}
      key='save'
    />,
    <IconButton
      icon={<MaterialIcon icon='close' />}
      title={t('common.actions.cancel', 'Cancel')}
      onClick={onCancel}
      key='cancel'
    />,
  ]

  useKeyListener({
    onKeyDown: event => {
      if (event.code === ESCAPE) {
        onCancel()
        return true
      }

      return false
    },
  })

  useFormCallbacks(form, {
    onSubmit,
  })

  return (
    <form noValidate={true} onSubmit={submit}>
      <TextField
        {...bindInput('description')}
        ref={autoFocusRef}
        label={t('maps.details.mapDescription', 'Map description')}
        multiline={true}
        rows={5}
        maxRows={5}
        trailingIcons={trailingIcons}
      />
    </form>
  )
}

interface MapDetailsProps extends CommonDialogProps {
  mapId: string
}

export default function MapDetails({ mapId, onCancel }: MapDetailsProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const mapDetails = useAppSelector(s => s.mapDetails)
  const auth = useAppSelector(s => s.auth)
  const [isEditingName, setIsEditingName] = useState(false)
  const [isEditingDescription, setIsEditingDescription] = useState(false)

  useEffect(() => {
    dispatch(getMapDetails(mapId))
  }, [dispatch, mapId])

  const map = mapDetails.map

  let canEdit = false
  if (map) {
    if (map.visibility === MapVisibility.Official || map.visibility === MapVisibility.Public) {
      canEdit = auth.self?.permissions.manageMaps ?? false
    } else if (map.visibility === MapVisibility.Private) {
      canEdit = map.uploadedBy === auth.self?.user.id
    }
  }

  function renderContents() {
    if (mapDetails.isRequesting) {
      return (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    }
    if (mapDetails.lastError) {
      return (
        <>
          <p>
            {t(
              'maps.details.retrieveError',
              'Something went wrong while trying to retrieve the details of this map.' +
                ' The error message was:',
            )}
          </p>
          <ErrorText as='p'>{mapDetails.lastError.message}</ErrorText>
        </>
      )
    }
    if (!map) {
      return null
    }

    return (
      <Container>
        <MapInfo>
          {isEditingName ? (
            <NameForm
              initialName={map.name}
              onSubmit={({ name }) => {
                dispatch(updateMap(mapId, name, map.description))
                setIsEditingName(false)
              }}
              onCancel={() => setIsEditingName(false)}
            />
          ) : (
            <MapName $canEdit={canEdit}>
              {map.name || ' '}
              {canEdit ? (
                <EditButton
                  name='name'
                  icon={<MaterialIcon icon='edit' />}
                  title={t('maps.details.editName', 'Edit name')}
                  onClick={() => setIsEditingName(true)}
                />
              ) : null}
            </MapName>
          )}
          {isEditingDescription ? (
            <DescriptionForm
              initialDescription={map.description}
              onSubmit={({ description }) => {
                dispatch(updateMap(mapId, map.name, description))
                setIsEditingDescription(false)
              }}
              onCancel={() => setIsEditingDescription(false)}
            />
          ) : (
            <MapDescriptionWrapper>
              <MapDescription $canEdit={canEdit}>
                {map.description}
                {canEdit ? (
                  <EditButton
                    name='description'
                    icon={<MaterialIcon icon='edit' />}
                    title={t('maps.details.editDescription', 'Edit description')}
                    onClick={() => setIsEditingDescription(true)}
                  />
                ) : null}
              </MapDescription>
            </MapDescriptionWrapper>
          )}
          <MapData>
            <MapDataItem>
              <Trans t={t} i18nKey='maps.details.size'>
                Size: {{ width: map.mapData.width }}x{{ height: map.mapData.height }}
              </Trans>
            </MapDataItem>
            <MapDataItem>
              <Trans t={t} i18nKey='maps.details.tileset'>
                Tileset: {{ tilesetName: tilesetToName(map.mapData.tileset, t) }}
              </Trans>
            </MapDataItem>
            <MapDataItem>
              <Trans t={t} i18nKey='maps.details.players'>
                Players: {{ playerSize: map.mapData.slots }}
              </Trans>
            </MapDataItem>
          </MapData>
        </MapInfo>
        <StyledMapThumbnail map={map} />
      </Container>
    )
  }

  return (
    <Dialog
      title={t('maps.details.title', 'Map details')}
      showCloseButton={true}
      onCancel={onCancel}>
      {renderContents()}
    </Dialog>
  )
}
