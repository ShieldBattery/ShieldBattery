import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import styled from 'styled-components'

import Dialog from '../material/dialog.jsx'
import form from '../forms/form.jsx'
import IconButton from '../material/icon-button.jsx'
import KeyListener from '../keyboard/key-listener.jsx'
import { Label } from '../material/button.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import MapThumbnail from './map-thumbnail.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'
import SubmitOnEnter from '../forms/submit-on-enter.jsx'
import TextField from '../material/text-field.jsx'

import { getMapDetails, updateMap } from './action-creators'

import CancelIcon from '../icons/material/baseline-clear-24px.svg'
import EditIcon from '../icons/material/edit-24px.svg'
import SaveIcon from '../icons/material/check-24px.svg'

import {
  MAP_VISIBILITY_OFFICIAL,
  MAP_VISIBILITY_PRIVATE,
  MAP_VISIBILITY_PUBLIC,
} from '../../app/common/constants'
import { required } from '../forms/validators'
import { colorError, colorTextSecondary } from '../styles/colors'
import { Display1, Subheading, Body1, singleLine } from '../styles/typography'

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

const ErrorText = styled(Subheading)`
  color: ${colorError};
`

const MapInfo = styled.div`
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  min-height: 220px;
  margin-right: 16px;
`

const MapName = styled(Display1)`
  flex-shrink: 0;
  position: relative;
  /* dialog max-width - dialog padding - map info margin - map image */
  max-width: calc(768px - 48px - 16px - 220px);
  margin: 0;
  margin-bottom: 16px;
  padding-right: ${props => (props.canEdit ? '68px' : '16px')};
  line-height: 48px;
  letter-spacing: 0.25px;
  ${singleLine};
`

const MapDescriptionWrapper = styled.div`
  height: 120px;
`

const MapDescription = styled(Subheading)`
  position: relative;
  margin: 0;
  padding-right: ${props => (props.canEdit ? '68px' : '16px')};
  letter-spacing: 0.5px;
  white-space: pre-wrap;
  overflow-wrap: break-word;
`

const EditButton = styled(IconButton)`
  position: absolute;
  top: 0;
  right: 16px;

  & ${Label} {
    color: ${colorTextSecondary};
  }
`

const MapData = styled.div`
  display: flex;
  justify-content: space-between;
  margin-top: 16px;
`

const MapDataItem = styled(Body1)`
  letter-spacing: 0.25px;
  color: ${colorTextSecondary};
`

const StyledMapThumbnail = styled(MapThumbnail)`
  flex-shrink: 0;
  width: 220px;
  height: 220px;
`

@form({ name: required('Enter a map name') })
class NameForm extends React.Component {
  render() {
    const { onSubmit, bindInput, inputRef, onCancel } = this.props
    const trailingIcons = [
      <IconButton icon={<SaveIcon />} title='Save' onClick={onSubmit} />,
      <IconButton icon={<CancelIcon />} title='Cancel' onClick={onCancel} />,
    ]

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <KeyListener onKeyDown={this.onKeyDown} />
        <SubmitOnEnter />
        <TextField
          {...bindInput('name')}
          ref={inputRef}
          label='Map name'
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

@form({ description: required('Enter a map description') })
class DescriptionForm extends React.Component {
  render() {
    const { onSubmit, bindInput, inputRef, onCancel } = this.props
    const trailingIcons = [
      <IconButton icon={<SaveIcon />} title='Save' onClick={onSubmit} />,
      <IconButton icon={<CancelIcon />} title='Cancel' onClick={onCancel} />,
    ]

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <KeyListener onKeyDown={this.onKeyDown} />
        <TextField
          {...bindInput('description')}
          ref={inputRef}
          label='Map description'
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

  _getEditButton = field => {
    return (
      <EditButton
        name={field}
        icon={<EditIcon />}
        title={`Edit ${field}`}
        onClick={this.onEditClick}
      />
    )
  }

  renderContents() {
    const { auth, mapDetails } = this.props
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
            Something went wrong while trying to retrieve the details of this map. The error message
            was:
          </p>
          <ErrorText as='p'>{mapDetails.lastError.message}</ErrorText>
        </>
      )
    }
    if (!map) {
      return null
    }

    let canEdit = false
    if (map.visibility === MAP_VISIBILITY_OFFICIAL || map.visibility === MAP_VISIBILITY_PUBLIC) {
      canEdit = auth.permissions.manageMaps
    } else if (map.visibility === MAP_VISIBILITY_PRIVATE) {
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
              {map.name}
              {canEdit ? this._getEditButton('name') : null}
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
              <ScrollableContent>
                <MapDescription canEdit={canEdit}>
                  {map.description}
                  {canEdit ? this._getEditButton('description') : null}
                </MapDescription>
              </ScrollableContent>
            </MapDescriptionWrapper>
          )}
          <MapData>
            <MapDataItem>
              Size: {map.mapData.width}x{map.mapData.height}
            </MapDataItem>
            <MapDataItem>Tileset: {map.mapData.tileset}</MapDataItem>
            <MapDataItem>Players: {map.mapData.slots}</MapDataItem>
          </MapData>
        </MapInfo>
        <StyledMapThumbnail map={map} />
      </Container>
    )
  }

  render() {
    return (
      <Dialog title={'Map details'} showCloseButton={true} onCancel={this.props.onCancel}>
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
