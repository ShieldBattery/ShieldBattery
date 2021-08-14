import { List, Range } from 'immutable'
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { MapInfoJson } from '../../common/maps'
import { MatchmakingType } from '../../common/matchmaking'
import { AssignedRaceChar, RaceChar } from '../../common/races'
import { closeOverlay, openOverlay } from '../activities/action-creators'
import { useSelfUser } from '../auth/state-hooks'
import { ComingSoon } from '../coming-soon/coming-soon'
import { useForm } from '../forms/form-hook'
import BrowseIcon from '../icons/material/ic_casino_black_24px.svg'
import KeyListener from '../keyboard/key-listener'
import { RacePicker, RacePickerProps, RacePickerSize } from '../lobbies/race-picker'
import { BrowseButton } from '../maps/map-select'
import { MapThumbnail } from '../maps/map-thumbnail'
import { animationFrameHandler } from '../material/animation-frame-handler'
import { RaisedButton } from '../material/button'
import CheckBox from '../material/check-box'
import { TabItem, Tabs } from '../material/tabs'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { amberA400, colorDividers, colorError, colorTextSecondary } from '../styles/colors'
import { body1, body2, Headline5, subtitle1, Subtitle2 } from '../styles/typography'
import { findMatch, updateMatchmakingPreferences } from './action-creators'
import {
  MatchmakingPreferencesData1v1Record,
  MatchmakingPreferencesRecord,
} from './matchmaking-preferences-reducer'

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

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

const ScrollDivider = styled.div<{ show: boolean }>`
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

const MapSelectionsHeader = styled.div`
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

const MapSelectionsContainer = styled.div`
  margin-top: 40px;
`

const MapSelections = styled.div`
  display: flex;
  margin: 24px 0;
`

const SelectedMap = styled.div`
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

interface RaceSelectProps extends Omit<RacePickerProps, 'race'> {
  value: RaceChar | null
  onChange: (race: RaceChar) => void
}

// A wrapper around <RacePicker /> so it can be used in forms
const RaceSelect = (props: RaceSelectProps) => {
  const { value, onChange, ...restProps } = props

  return <StyledRacePicker {...restProps} race={value!} onSetRace={onChange} />
}

interface FormRef {
  submit: () => void
}

interface FindMatch1v1Model {
  race: RaceChar
  useAlternateRace: boolean
  alternateRace: RaceChar
}

interface Form1v1Props {
  model: FindMatch1v1Model
  onChange: (model: FindMatch1v1Model) => void
  onSubmit: (model: FindMatch1v1Model) => void
}

const FindMatch1v1Form = React.forwardRef<FormRef, Form1v1Props>((props, ref) => {
  const {
    onSubmit: handleSubmit,
    bindCheckable,
    bindCustom,
    getInputValue,
  } = useForm<FindMatch1v1Model>(
    props.model,
    {},
    { onChange: props.onChange, onSubmit: props.onSubmit },
  )

  useImperativeHandle(ref, () => ({
    submit: handleSubmit,
  }))

  const race = getInputValue('race')
  const useAlternateRace = race !== 'r' ? getInputValue('useAlternateRace') : false
  const hiddenAlternateRaces = race !== 'r' ? [race] : []

  return (
    <form noValidate={true} onSubmit={handleSubmit}>
      <SectionTitle>Race</SectionTitle>
      <RaceSelect {...bindCustom('race')} size={RacePickerSize.Large} />
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
            hiddenRaces={hiddenAlternateRaces}
            size={RacePickerSize.Large}
            allowRandom={false}
          />
        </>
      ) : null}
    </form>
  )
})

interface FindMatch2v2Model {
  race: RaceChar
}

interface Form2v2Props {
  model: FindMatch2v2Model
  onChange: (model: FindMatch2v2Model) => void
  onSubmit: (model: FindMatch2v2Model) => void
}

const FindMatch2v2Form = React.forwardRef<FormRef, Form2v2Props>((props, ref) => {
  const { onSubmit: handleSubmit, bindCustom } = useForm<FindMatch2v2Model>(
    props.model,
    {},
    { onChange: props.onChange, onSubmit: props.onSubmit },
  )

  useImperativeHandle(ref, () => ({
    submit: handleSubmit,
  }))

  return (
    <form noValidate={true} onSubmit={handleSubmit}>
      <SectionTitle>Race</SectionTitle>
      <RaceSelect {...bindCustom('race')} size={RacePickerSize.Large} />
    </form>
  )
})

interface FindMatchProps {
  type: MatchmakingType | '3v3'
  mapSelections: List<MapInfoJson>
}

export function FindMatch(props: FindMatchProps) {
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const matchmakingPreferences = useAppSelector(s => s.matchmakingPreferences)
  const matchmakingStatus = useAppSelector(s => s.matchmakingStatus)

  const [activeTab, setActiveTab] = useState(
    props.type || matchmakingPreferences.lastQueuedMatchmakingType,
  )
  const [isScrolledUp, setIsScrolledUp] = useState(false)
  const form1v1Ref = useRef<FormRef>(null)
  const form2v2Ref = useRef<FormRef>(null)

  const prefs =
    activeTab !== '3v3'
      ? matchmakingPreferences.typeToPreferences.get(activeTab)!
      : new MatchmakingPreferencesRecord()
  const mapSelections = props.mapSelections || prefs.mapSelections

  const [tempPrefs, setTempPrefs] = useState(prefs)

  const onTabChange = useCallback(
    (value: MatchmakingType | '3v3') => {
      setActiveTab(value)

      const newTabPrefs =
        value !== '3v3'
          ? matchmakingPreferences.typeToPreferences.get(value)!
          : new MatchmakingPreferencesRecord()
      setTempPrefs(newTabPrefs)
    },
    [matchmakingPreferences],
  )

  const onBrowseMapSelections = useCallback(() => {
    dispatch(
      openOverlay('browseMapSelections', {
        type: activeTab,
        mapSelections: mapSelections.map(m => m.id),
      }) as any,
    )
  }, [activeTab, mapSelections, dispatch])

  const onPreferencesChanged = useCallback(
    model => {
      switch (activeTab) {
        case MatchmakingType.Match1v1:
          const typed1v1Model = model as FindMatch1v1Model
          const new1v1Prefs = tempPrefs.merge({
            race: typed1v1Model.race,
            data: new MatchmakingPreferencesData1v1Record({
              useAlternateRace: typed1v1Model.useAlternateRace,
              alternateRace: typed1v1Model.alternateRace as AssignedRaceChar,
            }),
          })

          setTempPrefs(new1v1Prefs)
          dispatch(
            updateMatchmakingPreferences(activeTab, new1v1Prefs, mapSelections, selfUser.id!),
          )
          break
        case MatchmakingType.Match2v2:
          const typed2v2Model = model as FindMatch2v2Model
          const new2v2Prefs = tempPrefs.merge({ race: typed2v2Model.race })

          setTempPrefs(new2v2Prefs)
          dispatch(
            updateMatchmakingPreferences(activeTab, new2v2Prefs, mapSelections, selfUser.id!),
          )
          break
        case '3v3':
          break
        default:
          assertUnreachable(activeTab)
      }
    },
    [activeTab, tempPrefs, mapSelections, selfUser, dispatch],
  )

  const onFindMatchSubmit = useCallback(() => {
    if (activeTab === '3v3') {
      return
    }
    dispatch(findMatch(activeTab, tempPrefs, mapSelections, selfUser.id!))
    dispatch(closeOverlay() as any)
  }, [activeTab, tempPrefs, mapSelections, selfUser, dispatch])

  const onFindClick = useCallback(() => {
    switch (activeTab) {
      case MatchmakingType.Match1v1:
        form1v1Ref.current?.submit()
        break
      case MatchmakingType.Match2v2:
        form2v2Ref.current?.submit()
        break
      case '3v3':
        break
      default:
        assertUnreachable(activeTab)
    }
  }, [activeTab])

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.code === ENTER || event.code === ENTER_NUMPAD) {
        onFindClick()
        return true
      }

      return false
    },
    [onFindClick],
  )

  const onScrollUpdate = animationFrameHandler(target => {
    if (!target) {
      return
    }

    const { scrollTop, scrollHeight, clientHeight } = target as HTMLDivElement
    const newIsScrolledUp = scrollTop + clientHeight < scrollHeight

    if (newIsScrolledUp !== isScrolledUp) {
      setIsScrolledUp(newIsScrolledUp)
    }
  })

  useEffect(() => {
    return () => onScrollUpdate.cancel()
  }, [onScrollUpdate])

  let formContents: React.ReactNode
  let mapSelectionsText: string
  switch (activeTab) {
    case MatchmakingType.Match1v1:
      formContents = (
        <FindMatch1v1Form
          ref={form1v1Ref}
          model={{
            race: tempPrefs.race,
            useAlternateRace: tempPrefs.data.useAlternateRace,
            alternateRace: tempPrefs.data.alternateRace,
          }}
          onChange={onPreferencesChanged}
          onSubmit={onFindMatchSubmit}
        />
      )
      mapSelectionsText = `
        Select up to 2 maps to be used in the per-match map pool. Your selections
        will be combined with your opponent’s to form the 4 map pool. Any unused selections will be
        replaced with a random map choice for each match.
      `
      break

    case MatchmakingType.Match2v2:
      formContents = (
        <FindMatch2v2Form
          ref={form2v2Ref}
          model={{ race: tempPrefs.race }}
          onChange={onPreferencesChanged}
          onSubmit={onFindMatchSubmit}
        />
      )
      // TODO(2Pac): Write an actual description of the map selections in the 2v2 matchmaking
      mapSelectionsText = `
        Select up to 2 maps to be used in the per-match map pool. Your selections
        will be combined with your opponent’s to form the 4 map pool. Any unused selections will be
        replaced with a random map choice for each match.
      `
      break

    case '3v3':
      formContents = null
      mapSelectionsText = ''
      break

    default:
      assertUnreachable(activeTab)
  }

  const mapSelectionItems = Range(0, 2).map(index => {
    const map = mapSelections.get(index)
    return (
      <SelectedMap key={index}>
        {map ? (
          <MapThumbnail map={map} showMapName={true} onClick={onBrowseMapSelections} />
        ) : (
          <BrowseButton onClick={onBrowseMapSelections}>
            <RandomContainer>
              <RandomIcon />
              <Subtitle2>Random map</Subtitle2>
            </RandomContainer>
          </BrowseButton>
        )}
      </SelectedMap>
    )
  })

  const status = matchmakingStatus.types.get(activeTab)
  const isMatchmakingEnabled = status && status.enabled

  return (
    <Container>
      <TitleBar>
        <Headline5>Find match</Headline5>
      </TitleBar>
      <Tabs bottomDivider={true} activeTab={activeTab} onChange={onTabChange}>
        <TabItem text='1 vs 1' value={MatchmakingType.Match1v1} />
        <TabItem text='2 vs 2' value={MatchmakingType.Match2v2} />
        <TabItem text='3 vs 3' value={'3v3'} />
      </Tabs>

      {activeTab === MatchmakingType.Match1v1 ? (
        <>
          <KeyListener onKeyDown={onKeyDown} />
          <Contents onScroll={onScrollUpdate.handler}>
            <ContentsBody>
              {formContents}
              <MapSelectionsContainer>
                <MapSelectionsHeader>
                  <SectionTitle>Preferred maps</SectionTitle>
                  {tempPrefs.mapPoolOutdated ? (
                    <OutdatedIndicator>Map pool changed</OutdatedIndicator>
                  ) : null}
                </MapSelectionsHeader>
                <DescriptionText>{mapSelectionsText}</DescriptionText>
                <MapSelections>{mapSelectionItems}</MapSelections>
              </MapSelectionsContainer>
            </ContentsBody>
          </Contents>
          <Actions>
            <ScrollDivider show={isScrolledUp} />
            <RaisedButton
              label='Find match'
              disabled={!isMatchmakingEnabled}
              onClick={onFindClick}
            />
            {!isMatchmakingEnabled ? (
              <ErrorText>Matchmaking is currently disabled</ErrorText>
            ) : null}
          </Actions>
        </>
      ) : (
        <Contents>
          <ContentsBody>
            <ComingSoon />
          </ContentsBody>
        </Contents>
      )}
    </Container>
  )
}
