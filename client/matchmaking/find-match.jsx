import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { Range } from 'immutable'
import styled from 'styled-components'

import { BrowseButton } from '../maps/map-select.jsx'
import CheckBox from '../material/check-box.jsx'
import form from '../forms/form.jsx'
import KeyListener from '../keyboard/key-listener.jsx'
import MapThumbnail from '../maps/map-thumbnail.jsx'
import RacePicker, { RACE_PICKER_SIZE_LARGE } from '../lobbies/race-picker.jsx'
import RaisedButton from '../material/raised-button.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'
import Tabs, { TabItem } from '../material/tabs.jsx'

import BrowseIcon from '../icons/material/ic_casino_black_24px.svg'

import { findMatch } from './action-creators'
import { openOverlay, closeOverlay } from '../activities/action-creators'

import { MATCHMAKING_TYPE_1V1 } from '../../common/constants'

import { colorDividers, colorTextSecondary } from '../styles/colors'
import { Body1, Headline, Subheading } from '../styles/typography'

const ENTER = 'Enter'

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
  margin: 16px 24px;
`

const Overline = styled(Subheading)`
  margin: 8px 0;
  color: ${colorTextSecondary};
`

const StyledRacePicker = styled(RacePicker)`
  margin: 12px 0;
`

const DescriptionText = styled(Body1)`
  color: ${colorTextSecondary};
  font-size: 12px;
`

const PreferredMapsContainer = styled.div`
  margin-top: 40px;
`

const PreferredMaps = styled.div`
  display: flex;
  margin-top: 16px;
`

const PreferredMap = styled.div`
  width: 256px;
  height: 256px;

  &:not(:first-child) {
    margin-left: 32px;
  }
`

// A wrapper around <RacePicker /> so it can be used in forms
const RaceSelect = props => {
  const { value, onChange, ...restProps } = props

  return <StyledRacePicker race={value} onSetRace={onChange} {...restProps} />
}

@form()
class Find1vs1MatchForm extends React.Component {
  static propTypes = {
    preferredMaps: PropTypes.array,
    onBrowsePreferred: PropTypes.func.isRequired,
    onSubmit: PropTypes.func.isRequired,
  }

  render() {
    const {
      preferredMaps,
      onBrowsePreferred,
      bindCheckable,
      bindCustom,
      getInputValue,
      onSubmit,
    } = this.props
    const useAlternateRace = getInputValue('useAlternateRace')
    const preferredMapsItems = Range(0, 2).map(index => {
      const map = preferredMaps[index]

      return (
        <PreferredMap key={index}>
          {map ? (
            <MapThumbnail map={map} showMapName={true} onClick={onBrowsePreferred} />
          ) : (
            <BrowseButton onClick={onBrowsePreferred}>
              <BrowseIcon />
              <Subheading>Random</Subheading>
            </BrowseButton>
          )}
        </PreferredMap>
      )
    })

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <Overline>Race</Overline>
        <RaceSelect {...bindCustom('race')} size={RACE_PICKER_SIZE_LARGE} />
        <CheckBox
          {...bindCheckable('useAlternateRace')}
          label='Use alternate race to avoid mirror matchups'
        />
        {useAlternateRace ? (
          <>
            <Overline>Alternate race</Overline>
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
          <Overline>Preferred maps</Overline>
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
      return MATCHMAKING_TYPE_1V1
    default:
      throw new Error('Invalid tab value')
  }
}

@connect()
export default class FindMatch extends React.Component {
  static propTypes = {
    initialPreferredMaps: PropTypes.array,
  }

  static defaultProps = {
    initialPreferredMaps: [],
  }

  state = {
    activeTab: TAB_1V1,
    scrolledUp: false,
    scrolledDown: false,
  }

  _form = React.createRef()

  renderContents() {
    const { initialPreferredMaps } = this.props
    const { activeTab } = this.state

    if (activeTab === TAB_2V2 || activeTab === TAB_3V3) {
      return (
        <Subheading>
          Team matchmaking is not implemented yet. It should become available really soon.
        </Subheading>
      )
    }

    const model = {
      race: 'p',
      useAlternateRace: true,
      alternateRace: 't',
    }

    return (
      <Find1vs1MatchForm
        ref={this._form}
        model={model}
        preferredMaps={initialPreferredMaps}
        onBrowsePreferred={this.onBrowsePreferred}
        onSubmit={this.onSubmit}
      />
    )
  }

  render() {
    const { activeTab, scrolledUp } = this.state

    return (
      <Container>
        <KeyListener onKeyDown={this.onKeyDown} />
        <TitleBar>
          <Headline>Find match</Headline>
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
            <RaisedButton label='Find match' onClick={this.onFindClick} />
          </Actions>
        ) : null}
      </Container>
    )
  }

  onTabChange = value => {
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
    const { initialPreferredMaps } = this.props
    const { activeTab } = this.state
    const preferredMapsProps = {
      type: tabToType(activeTab),
      preferredMaps: initialPreferredMaps,
    }
    this.props.dispatch(openOverlay('browsePreferredMaps', preferredMapsProps))
  }

  onFindClick = () => {
    this._form.current.submit()
  }

  onSubmit = () => {
    const { race, useAlternateRace, alternateRace, preferredMaps } = this._form.current.getModel()
    const alterRace = useAlternateRace ? alternateRace : undefined

    this.props.dispatch(findMatch(tabToType(this.state.activeTab), race, alterRace, preferredMaps))
    this.props.dispatch(closeOverlay())
  }

  onKeyDown = event => {
    if (event.code === ENTER) {
      this.onFindClick()
      return true
    }

    return false
  }
}
