import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { List, Set } from 'immutable'
import styled from 'styled-components'

import ActivityBackButton from '../activities/activity-back-button'
import form from '../forms/form'
import KeyListener from '../keyboard/key-listener'
import LoadingIndicator from '../progress/dots'
import MapPreview from '../maps/map-preview'
import MapSelect from '../maps/map-select'
import RaisedButton from '../material/raised-button'
import { ScrollableContent } from '../material/scroll-bar'

import SelectedIcon from '../icons/material/favorite-24px.svg'

import { openSimpleDialog } from '../dialogs/action-creators'
import { openOverlay } from '../activities/action-creators'
import { getCurrentMapPool } from './action-creators'
import { toggleFavoriteMap } from '../maps/action-creators'

import { MatchmakingType } from '../../common/matchmaking'

import { colorDividers, colorError, colorTextSecondary } from '../styles/colors'
import { Body1Old, HeadlineOld, SubheadingOld } from '../styles/typography'

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

const LoadingArea = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  height: 100%;
`

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`

const TitleBar = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  margin: 16px;

  & > h3 {
    margin: 0;
  }
`

const Contents = styled.div`
  flex-grow: 1;
`

const ContentsBody = styled.div`
  padding: 0 24px;
`

const InfoText = styled(Body1Old)`
  color: ${colorTextSecondary};
  font-size: 12px;
`

const ErrorText = styled(SubheadingOld)`
  color: ${colorError};
`

const ScrollDivider = styled.div`
  width: 100%;
  height: 1px;
  margin-top: ${props => (props.position === 'top' ? '-1px' : '0')};
  margin-bottom: ${props => (props.position === 'bottom' ? '-1px' : '0')};
  background-color: ${colorDividers};
`

const Footer = styled.div`
  display: flex;
  justify-content: flex-start;
  margin: 16px 24px;
`

const SelectionsTextContainer = styled.div`
  flex-grow: 1;
  display: flex;
  justify-content: center;
  align-items: center;
`

const SelectionsCount = styled(SubheadingOld)`
  margin: 0;
`

const SelectionsText = styled(SubheadingOld)`
  margin: 0;
  color: ${colorTextSecondary};
`

@form()
class PreferredMapsForm extends React.Component {
  static propTypes = {
    mapPool: PropTypes.object.isRequired,
    favoriteStatusRequests: PropTypes.instanceOf(Set),
    onMapPreview: PropTypes.func,
    onToggleFavoriteMap: PropTypes.func,
    onSubmit: PropTypes.func,
  }

  render() {
    const {
      mapPool,
      bindCustom,
      favoriteStatusRequests,
      onMapPreview,
      onToggleFavoriteMap,
      onSubmit,
    } = this.props

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <InfoText as='p'>
          Select up to 2 maps to be used in the per-match map pool. Your selections will be combined
          with your opponent’s to form the 4 map pool. Any unused selections will be replaced with a
          random map choice for each match.
        </InfoText>
        <MapSelect
          {...bindCustom('preferredMaps')}
          list={mapPool.maps}
          byId={mapPool.byId}
          maxSelections={2}
          selectedIcon={<SelectedIcon />}
          thumbnailSize='xlarge'
          allowUnselect={true}
          favoriteStatusRequests={favoriteStatusRequests}
          onMapPreview={onMapPreview}
          onToggleFavoriteMap={onToggleFavoriteMap}
        />
      </form>
    )
  }
}

@connect(state => ({ maps: state.maps, matchmaking: state.matchmaking }))
export default class PreferredMaps extends React.Component {
  static propTypes = {
    type: PropTypes.oneOf(Object.values(MatchmakingType)).isRequired,
    preferredMaps: PropTypes.instanceOf(List),
  }

  static defaultProps = {
    preferredMaps: new List(),
  }

  state = {
    selectionCount: -1,
  }

  _form = React.createRef()

  componentDidMount() {
    this.props.dispatch(getCurrentMapPool(this.props.type))
  }

  renderContents() {
    const { maps, matchmaking, type, preferredMaps } = this.props
    const mapPool = matchmaking.mapPoolTypes.get(type)

    if (!mapPool) return null

    if (mapPool.isRequesting) {
      return (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    }

    if (mapPool.lastError) {
      return <ErrorText>Something went wrong: {mapPool.lastError.message}</ErrorText>
    }

    const model = {
      preferredMaps,
    }

    return (
      <PreferredMapsForm
        ref={this._form}
        model={model}
        mapPool={mapPool}
        favoriteStatusRequests={maps.favoriteStatusRequests}
        onMapPreview={this.onMapPreview}
        onToggleFavoriteMap={this.onToggleFavoriteMap}
        onChange={this.onChange}
        onSubmit={this.onSubmit}
      />
    )
  }

  render() {
    const { preferredMaps } = this.props
    const { selectionCount } = this.state

    const selectCount = selectionCount === -1 ? preferredMaps.size : selectionCount
    return (
      <Container>
        <KeyListener onKeyDown={this.onKeyDown} />
        <TitleBar>
          <ActivityBackButton />
          <HeadlineOld>Select preferred maps</HeadlineOld>
        </TitleBar>
        <Contents>
          <ScrollDivider position='top' />
          <ScrollableContent>
            <ContentsBody>{this.renderContents()}</ContentsBody>
          </ScrollableContent>
          <ScrollDivider position='bottom' />
        </Contents>
        <Footer>
          <RaisedButton label='Confirm' onClick={this.onConfirmClick} />
          <SelectionsTextContainer>
            <SelectionsCount>{2 - selectCount}</SelectionsCount>&nbsp;
            <SelectionsText>selections left</SelectionsText>
          </SelectionsTextContainer>
        </Footer>
      </Container>
    )
  }

  onMapPreview = map => {
    this.props.dispatch(openSimpleDialog(map.name, <MapPreview map={map} />, false /* hasButton */))
  }

  onToggleFavoriteMap = map => {
    this.props.dispatch(toggleFavoriteMap(map, { matchmakingType: this.props.type }))
  }

  onConfirmClick = () => {
    this._form.current.submit()
  }

  onChange = () => {
    const { preferredMaps } = this._form.current.getModel()

    this.setState({ selectionCount: preferredMaps.size })
  }

  onSubmit = () => {
    const { preferredMaps } = this._form.current.getModel()
    const { matchmaking, type } = this.props

    const mapPool = matchmaking.mapPoolTypes.get(type)
    const preferred = preferredMaps.map(mapId => mapPool.byId.get(mapId))

    this.props.dispatch(openOverlay('findMatch', { preferredMaps: preferred }))
  }

  onKeyDown = event => {
    if (event.code === ENTER || event.code === ENTER_NUMPAD) {
      this.onConfirmClick()
      return true
    }

    return false
  }
}
