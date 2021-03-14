import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { List, Range } from 'immutable'
import styled from 'styled-components'

import { BrowseButton } from '../maps/map-select'
import CheckBox from '../material/check-box'
import form from '../forms/form'
import KeyListener from '../keyboard/key-listener'
import LoadingIndicator from '../progress/dots'
import MapThumbnail from '../maps/map-thumbnail'
import RacePicker, { RACE_PICKER_SIZE_LARGE } from '../lobbies/race-picker'
import RaisedButton from '../material/raised-button'
import { ScrollableContent } from '../material/scroll-bar'
import Tabs, { TabItem } from '../material/tabs'

import BrowseIcon from '../icons/material/ic_casino_black_24px.svg'

import {
  findMatch,
  getCurrentMapPool,
  getMatchmakingPreferences,
  updateMatchmakingPreferences,
} from './action-creators'
import { openOverlay, closeOverlay } from '../activities/action-creators'

import { MatchmakingType } from '../../common/matchmaking'

import { amberA400, colorDividers, colorTextSecondary, colorError } from '../styles/colors'
import {
  Headline5,
  Subtitle1,
  Subtitle2,
  subtitle1,
  body1,
  robotoCondensed,
} from '../styles/typography'

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
  padding: 12px 24px;
`

const ScrollDivider = styled.div`
  width: 100%;
  height: 1px;
  margin-top: ${props => (props.position === 'top' ? '-1px' : '0')};
  margin-bottom: ${props => (props.position === 'bottom' ? '-1px' : '0')};
  background-color: ${colorDividers};
`

const Actions = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  margin: 16px 24px;
`

const SectionTitle = styled.div`
  ${subtitle1};
  margin: 8px 0;
  color: ${colorTextSecondary};
`

const StyledRacePicker = styled(RacePicker)`
  margin: 12px 0;
`

const DescriptionText = styled.span`
  ${body1};
  color: ${colorTextSecondary};
  font-size: 12px;
`

const PreferredHeader = styled.div`
  display: flex;
  align-items: center;
`

const OutdatedIndicator = styled.span`
  ${robotoCondensed};
  margin-left: 16px;
  padding: 0 4px;
  color: ${amberA400};
  text-transform: uppercase;
  border: 1px solid ${amberA400};
  border-radius: 4px;
`

const PreferredMapsContainer = styled.div`
  margin-top: 40px;
`

const PreferredMaps = styled.div`
  display: flex;
  margin: 16px 0;
`

const PreferredMap = styled.div`
  width: 256px;
  height: 256px;

  &:not(:first-child) {
    margin-left: 32px;
  }
`

const RandomContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  position: absolute;
  left: 0;
  top: 44px;
  width: 100%;
`

const RandomIcon = styled(BrowseIcon)`
  width: 128px;
  height: 128px;
  opacity: 0.5;
  margin-bottom: 24px;
`

const ErrorText = styled.div`
  ${subtitle1};
  margin-left: 16px;
  color: ${colorError};
`

// A wrapper around <RacePicker /> so it can be used in forms
const RaceSelect = props => {
  const { value, onChange, ...restProps } = props

  return <StyledRacePicker race={value} onSetRace={onChange} {...restProps} />
}

@form()
class Find1vs1MatchForm extends React.Component {
  static propTypes = {
    preferredMaps: PropTypes.instanceOf(List),
    mapPoolOutdated: PropTypes.bool,
    onBrowsePreferred: PropTypes.func.isRequired,
    onSubmit: PropTypes.func.isRequired,
  }

  render() {
    const {
      preferredMaps,
      mapPoolOutdated,
      onBrowsePreferred,
      bindCheckable,
      bindCustom,
      getInputValue,
      onSubmit,
    } = this.props
    const race = getInputValue('race')
    const useAlternateRace = race !== 'r' ? getInputValue('useAlternateRace') : false
    const preferredMapsItems = Range(0, 2).map(index => {
      const map = preferredMaps.get(index)
      return (
        <PreferredMap key={index}>
          {map ? (
            <MapThumbnail map={map} showMapName={true} onClick={onBrowsePreferred} />
          ) : (
            <BrowseButton onClick={onBrowsePreferred}>
              <RandomContainer>
                <RandomIcon />
                <Subtitle2>Random map</Subtitle2>
              </RandomContainer>
            </BrowseButton>
          )}
        </PreferredMap>
      )
    })

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SectionTitle>Race</SectionTitle>
        <RaceSelect {...bindCustom('race')} size={RACE_PICKER_SIZE_LARGE} />
        {race !== 'r' ? (
          <CheckBox
            {...bindCheckable('useAlternateRace')}
            label='Use alternate race to avoid mirror matchups'
          />
        ) : (
          <CheckBox
            checked={false}
            disabled={true}
            label='Use alternate race to avoid mirror matchups (disabled for random)'
          />
        )}
        {useAlternateRace ? (
          <>
            <SectionTitle>Alternate race</SectionTitle>
            <DescriptionText>
              Select a race to be used whenever your opponent has selected the same primary race.
            </DescriptionText>
            <RaceSelect
              {...bindCustom('alternateRace')}
              size={RACE_PICKER_SIZE_LARGE}
              allowRandom={false}
            />
          </>
        ) : null}
        <PreferredMapsContainer>
          <PreferredHeader>
            <SectionTitle>Preferred maps</SectionTitle>
            {mapPoolOutdated ? <OutdatedIndicator>Map pool changed</OutdatedIndicator> : null}
          </PreferredHeader>
          <DescriptionText>
            Select up to 2 maps to be used in the per-match map pool. Your selections will be
            combined with your opponent’s to form the 4 map pool. Any unused selections will be
            replaced with a random map choice for each match.
          </DescriptionText>
          <PreferredMaps>{preferredMapsItems}</PreferredMaps>
        </PreferredMapsContainer>
      </form>
    )
  }
}

const TAB_1V1 = 0
const TAB_2V2 = 1
const TAB_3V3 = 2

function tabToType(tab) {
  switch (tab) {
    case TAB_1V1:
      return MatchmakingType.Match1v1
    default:
      throw new Error('Invalid tab value')
  }
}

function typeToTab(type) {
  switch (type) {
    case MatchmakingType.Match1v1:
      return TAB_1V1
    default:
      throw new Error('Invalid type value')
  }
}

@connect(state => ({
  matchmaking: state.matchmaking,
  matchmakingPreferences: state.matchmakingPreferences,
  matchmakingStatus: state.matchmakingStatus,
}))
export default class FindMatch extends React.Component {
  static propTypes = {
    preferredMaps: PropTypes.instanceOf(List),
  }

  state = {
    activeTab: TAB_1V1,
    scrolledUp: false,
    scrolledDown: false,
  }

  _form = React.createRef()

  _getPreferredMaps = () => {
    return this.props.preferredMaps || this.props.matchmakingPreferences.preferredMaps
  }

  _savePreferences = () => {
    const { activeTab } = this.state

    // This can happen if the component unmounts before the matchmaking preferences are finished
    // requesting (since the form won't be rendered in that case)
    if (!this._form.current) return

    // TODO(2Pac): Remove this once we add support for other tabs that we currently display
    if (activeTab !== TAB_1V1) return

    this.props.dispatch(
      updateMatchmakingPreferences({
        matchmakingType: tabToType(activeTab),
        ...this._form.current.getModel(),
        preferredMaps: this._getPreferredMaps().map(m => m.id),
      }),
    )
  }

  componentDidMount() {
    this.props.dispatch(getMatchmakingPreferences(tabToType(this.state.activeTab)))
    // This is needed so the current map pool is loaded in the store which will then be used to
    // download all the maps as soon as the player enters the queue.
    this.props.dispatch(getCurrentMapPool(tabToType(this.state.activeTab)))
    window.addEventListener('beforeunload', this._savePreferences)
  }

  componentDidUpdate(prevProps, prevState) {
    const {
      matchmakingPreferences: { isRequesting, matchmakingType, lastError },
    } = this.props

    if (prevProps.matchmakingPreferences.isRequesting && !isRequesting) {
      if (lastError) return

      this.setState({
        activeTab: typeToTab(matchmakingType),
      })
    }

    // TODO(2Pac): Get preferences and the map pool for the new tab when the tab changes (once we
    // add support for other matchmaking types that we currently display tabs for)
    if (prevState.activeTab !== TAB_1V1 && this.state.activeTab === TAB_1V1) {
      this.props.dispatch(getMatchmakingPreferences(tabToType(this.state.activeTab)))
      this.props.dispatch(getCurrentMapPool(tabToType(this.state.activeTab)))
    }
  }

  componentWillUnmount() {
    // Saves the matchmaking preferences if the component had time to unmount. If it didn't, eg. the
    // page was refreshed, the 'beforeunload' event listener will handle it.
    this._savePreferences()
    window.removeEventListener('beforeunload', this._savePreferences)
  }

  renderContents() {
    const { matchmakingPreferences } = this.props
    const { activeTab } = this.state

    if (activeTab === TAB_2V2 || activeTab === TAB_3V3) {
      return (
        <Subtitle1>
          Team matchmaking is not implemented yet. It should become available really soon.
        </Subtitle1>
      )
    }

    const { race, useAlternateRace, alternateRace, mapPoolOutdated } = matchmakingPreferences
    const model = {
      race: race || 'r',
      useAlternateRace: !!useAlternateRace,
      alternateRace: alternateRace || 'z',
    }

    return (
      <Find1vs1MatchForm
        ref={this._form}
        model={model}
        preferredMaps={this._getPreferredMaps()}
        mapPoolOutdated={mapPoolOutdated}
        onBrowsePreferred={this.onBrowsePreferred}
        onSubmit={this.onSubmit}
      />
    )
  }

  render() {
    const { matchmaking, matchmakingPreferences, matchmakingStatus } = this.props
    const { activeTab, scrolledUp } = this.state

    // TODO(2Pac): Remove this check once we add support for other tabs that we currently display
    const mapPool =
      activeTab === TAB_1V1 ? matchmaking.mapPoolTypes.get(tabToType(activeTab)) : null

    if ((mapPool && mapPool.isRequesting) || matchmakingPreferences.isRequesting) {
      return (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    }

    // TODO(2Pac): Remove this check once we add support for other tabs that we currently display
    const status = activeTab === TAB_1V1 ? matchmakingStatus.types.get(tabToType(activeTab)) : null
    const isMatchmakingDisabled = !status || !status.enabled
    return (
      <Container>
        <KeyListener onKeyDown={this.onKeyDown} />
        <TitleBar>
          <Headline5>Find match</Headline5>
        </TitleBar>
        <Tabs activeTab={activeTab} onChange={this.onTabChange}>
          <TabItem text='1 vs 1' />
          <TabItem text='2 vs 2' />
          <TabItem text='3 vs 3' />
        </Tabs>
        <Contents>
          <ScrollDivider position='top' />
          <ScrollableContent onUpdate={this.onScrollUpdate}>
            <ContentsBody>{this.renderContents()}</ContentsBody>
          </ScrollableContent>
          {scrolledUp ? <ScrollDivider position='bottom' /> : null}
        </Contents>
        {activeTab === TAB_1V1 ? (
          <Actions>
            <RaisedButton
              label='Find match'
              disabled={isMatchmakingDisabled}
              onClick={this.onFindClick}
            />
            {isMatchmakingDisabled ? <ErrorText>Matchmaking is now disabled</ErrorText> : null}
          </Actions>
        ) : null}
      </Container>
    )
  }

  onTabChange = value => {
    this._savePreferences()
    this.setState({ activeTab: value })
  }

  onScrollUpdate = values => {
    const { scrollTop, scrollHeight, clientHeight } = values
    const scrolledUp = scrollTop + clientHeight < scrollHeight
    const scrolledDown = scrollTop > 0

    if (scrolledUp !== this.state.scrolledUp || scrolledDown !== this.state.scrolledDown) {
      this.setState({ scrolledUp, scrolledDown })
    }
  }

  onBrowsePreferred = () => {
    const { activeTab } = this.state
    const preferredMapsProps = {
      type: tabToType(activeTab),
      preferredMaps: this._getPreferredMaps().map(m => m.id),
    }
    this.props.dispatch(openOverlay('browsePreferredMaps', preferredMapsProps))
  }

  onFindClick = () => {
    this._form.current.submit()
  }

  onSubmit = () => {
    const { race, useAlternateRace, alternateRace } = this._form.current.getModel()
    const matchmakingType = tabToType(this.state.activeTab)
    const preferredMaps = this._getPreferredMaps().map(m => m.id)

    this.props.dispatch(
      findMatch(matchmakingType, race, useAlternateRace, alternateRace, preferredMaps),
    )
    this.props.dispatch(closeOverlay())
  }

  onKeyDown = event => {
    if (event.code === ENTER || event.code === ENTER_NUMPAD) {
      this.onFindClick()
      return true
    }

    return false
  }
}
