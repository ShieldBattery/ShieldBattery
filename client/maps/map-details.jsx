import PropTypes from 'prop-types'
import React from 'react'
import { Trans, withTranslation } from 'react-i18next'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { MapVisibility, tilesetToName } from '../../common/maps'
import form from '../forms/form'
import SubmitOnEnter from '../forms/submit-on-enter'
import { required } from '../forms/validators'
import { MaterialIcon } from '../icons/material/material-icon'
import KeyListener from '../keyboard/key-listener'
import { IconButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import LoadingIndicator from '../progress/dots'
import { colorError, colorTextSecondary } from '../styles/colors'
import { Body1Old, Display1Old, SubheadingOld, singleLine } from '../styles/typography'
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

const ErrorText = styled(SubheadingOld)`
  color: ${colorError};
`

const MapInfo = styled.div`
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  min-height: 220px;
  margin-right: 16px;
`

const MapName = styled(Display1Old)`
  flex-shrink: 0;
  position: relative;
  /* dialog max-width - dialog padding - map info margin - map image */
  max-width: calc(768px - 48px - 16px - 220px);
  margin: 0;
  margin-bottom: 16px;
  padding-right: ${props => (props.canEdit ? '68px' : '16px')};
  line-height: 48px;
  letter-spacing: 0.25px;
  user-select: text;
  ${singleLine};
`

const MapDescriptionWrapper = styled.div`
  height: 120px;
  overflow-y: auto;
`

const MapDescription = styled(SubheadingOld)`
  position: relative;
  margin: 0;
  padding-right: ${props => (props.canEdit ? '68px' : '16px')};
  letter-spacing: 0.5px;
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

const MapDataItem = styled(Body1Old)`
  letter-spacing: 0.25px;
  color: ${colorTextSecondary};
`

const StyledMapThumbnail = styled(MapThumbnail)`
  flex-shrink: 0;
  width: 220px;
  height: 220px;
`

@form({ name: required(t => t('maps.details.mapNameRequired', 'Enter a map name')) })
class NameForm extends React.Component {
  render() {
    const { onSubmit, bindInput, inputRef, onCancel, t } = this.props
    const trailingIcons = [
      <IconButton
        icon={<MaterialIcon icon='check' />}
        title={t('common.actions.save', 'Save')}
        onClick={onSubmit}
      />,
      <IconButton
        icon={<MaterialIcon icon='close' />}
        title={t('common.actions.cancel', 'Cancel')}
        onClick={onCancel}
      />,
    ]

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <KeyListener onKeyDown={this.onKeyDown} />
        <SubmitOnEnter />
        <TextField
          {...bindInput('name')}
          ref={inputRef}
          label={t('maps.details.mapName', 'Map name')}
          trailingIcons={trailingIcons}
        />
      </form>
    )
  }

  onKeyDown = event => {
    if (event.code === ESCAPE) {
      this.props.onCancel()
      return true
    }

    return false
  }
}

@form({
  description: required(t => t('maps.details.mapDescriptionRequired', 'Enter a map description')),
})
class DescriptionForm extends React.Component {
  render() {
    const { onSubmit, bindInput, inputRef, onCancel, t } = this.props
    const trailingIcons = [
      <IconButton
        icon={<MaterialIcon icon='check' />}
        title={t('common.actions.save', 'Save')}
        onClick={onSubmit}
      />,
      <IconButton
        icon={<MaterialIcon icon='close' />}
        title={t('common.actions.cancel', 'Cancel')}
        onClick={onCancel}
      />,
    ]

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <KeyListener onKeyDown={this.onKeyDown} />
        <TextField
          {...bindInput('description')}
          ref={inputRef}
          label={t('maps.details.mapDescription', 'Map description')}
          multiline={true}
          rows={5}
          maxRows={5}
          trailingIcons={trailingIcons}
        />
      </form>
    )
  }

  onKeyDown = event => {
    if (event.code === ESCAPE) {
      this.props.onCancel()
      return true
    }

    return false
  }
}

@withTranslation()
@connect(state => ({ auth: state.auth, mapDetails: state.mapDetails }))
export default class MapDetails extends React.Component {
  static propTypes = {
    mapId: PropTypes.string.isRequired,
  }

  state = {
    isEditingName: false,
    isEditingDescription: false,
  }

  _nameForm = React.createRef()
  _descriptionForm = React.createRef()
  _nameInput = React.createRef()
  _descriptionInput = React.createRef()

  componentDidMount() {
    this.props.dispatch(getMapDetails(this.props.mapId))
  }

  componentDidUpdate(prevProps, prevState) {
    if (!prevState.isEditingName && this.state.isEditingName) {
      this._nameInput.current.focus()
    } else if (!prevState.isEditingDescription && this.state.isEditingDescription) {
      this._descriptionInput.current.focus()
    }
  }

  renderContents() {
    const { auth, mapDetails, t } = this.props
    const { isEditingName, isEditingDescription } = this.state
    const { map } = mapDetails

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

    let canEdit = false
    if (map.visibility === MapVisibility.Official || map.visibility === MapVisibility.Public) {
      canEdit = auth.permissions.manageMaps
    } else if (map.visibility === MapVisibility.Private) {
      canEdit = map.uploadedBy.id === auth.user.id
    }

    return (
      <Container>
        <MapInfo>
          {isEditingName ? (
            <NameForm
              ref={this._nameForm}
              inputRef={this._nameInput}
              model={{ name: map.name }}
              onSubmit={() => this.onSave('name')}
              onCancel={() => this.onCancel('name')}
            />
          ) : (
            <MapName canEdit={canEdit}>
              {
                // NOTE(tec27): atm if the map name is missing this will end up with 0 height, so
                // we replace it with a non-breaking space character in that case.
                // TODO(tec27): Do this layout differently such that the button actually
                // contributes to the layout size and isn't just positioned absolutely in padding
                map.name || ' '
              }
              {canEdit ? (
                <EditButton
                  name='name'
                  icon={<MaterialIcon icon='edit' />}
                  title={t('maps.details.editName', 'Edit name')}
                  onClick={this.onEditClick}
                />
              ) : null}
            </MapName>
          )}
          {isEditingDescription ? (
            <DescriptionForm
              ref={this._descriptionForm}
              inputRef={this._descriptionInput}
              model={{ description: map.description }}
              onSubmit={() => this.onSave('description')}
              onCancel={() => this.onCancel('description')}
            />
          ) : (
            <MapDescriptionWrapper>
              <MapDescription canEdit={canEdit}>
                {map.description}
                {canEdit ? (
                  <EditButton
                    name='description'
                    icon={<MaterialIcon icon='edit' />}
                    title={t('maps.details.editDescription', 'Edit description')}
                    onClick={this.onEditClick}
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
                Tileset: {{ tilesetName: tilesetToName(map.mapData.tileset) }}
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

  render() {
    return (
      <Dialog
        title={this.props.t('maps.details.title', 'Map details')}
        showCloseButton={true}
        onCancel={this.props.onCancel}
        dialogRef={this.props.dialogRef}>
        {this.renderContents()}
      </Dialog>
    )
  }

  onEditClick = event => {
    const key = event.currentTarget.getAttribute('name')

    this.setState({
      isEditingName: key === 'name' ? true : this.state.isEditingName,
      isEditingDescription: key === 'description' ? true : this.state.isEditingDescription,
    })
  }

  onSave = field => {
    const { mapId, mapDetails } = this.props
    const { map } = mapDetails
    let name = map.name
    let description = map.description

    if (field === 'name') {
      name = this._nameForm.current.getModel().name
    } else if (field === 'description') {
      description = this._descriptionForm.current.getModel().description
    }

    this.props.dispatch(updateMap(mapId, name, description))
    this.onCancel(field)
  }

  onCancel = field => {
    this.setState({
      isEditingName: field === 'name' ? false : this.state.isEditingName,
      isEditingDescription: field === 'description' ? false : this.state.isEditingDescription,
    })
  }
}
