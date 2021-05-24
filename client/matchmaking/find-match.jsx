import { List, Range } from 'immutable'
import PropTypes from 'prop-types'
import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { MatchmakingType } from '../../common/matchmaking'
import { closeOverlay, openOverlay } from '../activities/action-creators'
import form from '../forms/form'
import BrowseIcon from '../icons/material/ic_casino_black_24px.svg'
import KeyListener from '../keyboard/key-listener'
import { RacePicker, RACE_PICKER_SIZE_LARGE } from '../lobbies/race-picker'
import { BrowseButton } from '../maps/map-select'
import { MapThumbnail } from '../maps/map-thumbnail'
import { animationFrameHandler } from '../material/animation-frame-handler'
import { RaisedButton } from '../material/button'
import CheckBox from '../material/check-box'
import { TabItem, Tabs } from '../material/tabs'
import { LoadingDotsArea } from '../progress/dots'
import { amberA400, colorDividers, colorError, colorTextSecondary } from '../styles/colors'
import { body1, body2, Headline5, Subtitle1, subtitle1, Subtitle2 } from '../styles/typography'
import {
  findMatch,
  getCurrentMapPool,
  getMatchmakingPreferences,
  updateMatchmakingPreferences,
} from './action-creators'

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

const StyledLoadingArea = styled(LoadingDotsArea)`
  height: 100%;
  display: flex;
  align-items: center;
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
  margin: 16px 24px;
`

const Contents = styled.div`
  flex-grow: 1;
  overflow-y: auto;
  contain: strict;
`

const ContentsBody = styled.div`
  padding: 12px 24px;
`

const ScrollDivider = styled.div`
  position: absolute;
  height: 1px;
  left: 0;
  right: 0;
  top: 0;

  background-color: ${props => (props.show ? colorDividers : 'transparent')};
  transition: background-color 150ms linear;
`

const Actions = styled.div`
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 16px 24px;
  contain: content;
`

const SectionTitle = styled.div`
  ${subtitle1};
  margin: 8px 0;
`

const StyledRacePicker = styled(RacePicker)`
  margin: 12px 0;
`

const DescriptionText = styled.span`
  ${body1};
  color: ${colorTextSecondary};
`

const PreferredHeader = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 8px;
`

const OutdatedIndicator = styled.span`
  ${body2};
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
  margin: 24px 0;
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
        ) : null}
        {useAlternateRace ? (
          <>
            <SectionTitle>Alternate race</SectionTitle>
            <DescriptionText>
              Select a race to be used whenever your opponent has selected the same primary race.
            </DescriptionText>
            <RaceSelect
              {...bindCustom('alternateRace')}
              hiddenRaces={[race]}
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
    this.onScrollUpdate.cancel()
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
          Team matchmaking is not yet enabled. It's in development and should be avalable soon.
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

    const isLoading = (mapPool && mapPool.isRequesting) || matchmakingPreferences.isRequesting

    // TODO(2Pac): Remove this check once we add support for other tabs that we currently display
    const status = activeTab === TAB_1V1 ? matchmakingStatus.types.get(tabToType(activeTab)) : null
    const isMatchmakingDisabled = !status || !status.enabled
    return (
      <Container>
        <TitleBar>
          <Headline5>Find match</Headline5>
        </TitleBar>
        <Tabs bottomDivider={true} activeTab={activeTab} onChange={this.onTabChange}>
          <TabItem text='1 vs 1' value={TAB_1V1} />
          <TabItem text='2 vs 2' value={TAB_2V2} />
          <TabItem text='3 vs 3' value={TAB_3V3} />
        </Tabs>

        {isLoading ? (
          <StyledLoadingArea />
        ) : (
          <>
            <KeyListener onKeyDown={this.onKeyDown} />
            <Contents onScroll={this.onScrollUpdate.handler}>
              <ContentsBody>{this.renderContents()}</ContentsBody>
            </Contents>
            {activeTab === TAB_1V1 ? (
              <Actions>
                <ScrollDivider show={scrolledUp} />
                <RaisedButton
                  label='Find match'
                  disabled={isMatchmakingDisabled}
                  onClick={this.onFindClick}
                />
                {isMatchmakingDisabled ? <ErrorText>Matchmaking is now disabled</ErrorText> : null}
              </Actions>
            ) : null}
          </>
        )}
      </Container>
    )
  }

  onTabChange = value => {
    this._savePreferences()
    this.setState({ activeTab: value })
  }

  onScrollUpdate = animationFrameHandler(target => {
    if (!target) {
      return
    }
    const scrolledUp = target.scrollTop + target.clientHeight < target.scrollHeight

    if (scrolledUp !== this.state.scrolledUp) {
      this.setState({ scrolledUp })
    }
  })

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
