import { Immutable } from 'immer'
import { List, Range } from 'immutable'
import React, { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { MapInfoJson } from '../../common/maps'
import {
  MatchmakingPreferences,
  MatchmakingPreferences1v1,
  MatchmakingType,
} from '../../common/matchmaking'
import { AssignedRaceChar, RaceChar } from '../../common/races'
import { closeOverlay } from '../activities/action-creators'
import { useSelfUser } from '../auth/state-hooks'
import { ComingSoon } from '../coming-soon/coming-soon'
import { useForm } from '../forms/form-hook'
import BrowseIcon from '../icons/material/ic_casino_black_24px.svg'
import KeyListener from '../keyboard/key-listener'
import { RacePicker, RacePickerProps, RacePickerSize } from '../lobbies/race-picker'
import { BrowseButton } from '../maps/map-select'
import { MapThumbnail } from '../maps/map-thumbnail'
import { RaisedButton } from '../material/button'
import CheckBox from '../material/check-box'
import { useScrollIndicatorState } from '../material/scroll-indicator'
import { TabItem, Tabs } from '../material/tabs'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { amberA400, colorDividers, colorError, colorTextSecondary } from '../styles/colors'
import { body1, body2, Headline5, subtitle1, Subtitle2 } from '../styles/typography'
import { findMatch, updateMatchmakingPreferences } from './action-creators'

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

export type RaceSelectOnChangeFunc<AllowRandom extends boolean | undefined> =
  AllowRandom extends false ? (race: AssignedRaceChar) => void : (race: RaceChar) => void

interface RaceSelectProps<AllowRandom extends boolean | undefined>
  extends Omit<RacePickerProps<AllowRandom>, 'race'> {
  value: RaceChar | null
  onChange: RaceSelectOnChangeFunc<AllowRandom>
}

// A wrapper around <RacePicker /> so it can be used in forms
const RaceSelect = <AllowRandom extends boolean | undefined>(
  props: RaceSelectProps<AllowRandom>,
) => {
  const { value, onChange, ...restProps } = props

  return <StyledRacePicker {...restProps} race={value!} onSetRace={onChange} />
}

interface FormRef {
  submit: () => void
}

interface FindMatchContentsProps {
  mapSelections?: List<MapInfoJson>
  formRef: React.Ref<FormRef>
  onSubmit: (prefs: Immutable<MatchmakingPreferences>) => void
}

interface Model1v1 {
  race: RaceChar
  mapSelections: string[]
  useAlternateRace: boolean
  alternateRace: AssignedRaceChar
}

interface Form1v1Props {
  model: Model1v1
  onChange: (model: Model1v1) => void
  onSubmit: (model: Model1v1) => void
}

const Form1v1 = React.forwardRef<FormRef, Form1v1Props>((props, ref) => {
  const {
    onSubmit: handleSubmit,
    bindCheckable,
    bindCustom,
    getInputValue,
  } = useForm<Model1v1>(props.model, {}, { onChange: props.onChange, onSubmit: props.onSubmit })

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

function model1v1ToPrefs(model: Model1v1, userId: number, mapPoolId: number) {
  return {
    userId,
    matchmakingType: MatchmakingType.Match1v1 as const,
    race: model.race,
    mapPoolId,
    mapSelections: model.mapSelections,
    data: {
      useAlternateRace: model.race !== 'r' ? model.useAlternateRace : false,
      alternateRace: model.alternateRace,
    },
  }
}

function Contents1v1({ formRef, onSubmit }: FindMatchContentsProps) {
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const prefs: Partial<Immutable<MatchmakingPreferences1v1>> = useAppSelector(
    s => s.matchmakingPreferences.byType.get(MatchmakingType.Match1v1)?.preferences ?? {},
  )
  const mapPoolOutdated = useAppSelector(
    s => s.matchmakingPreferences.byType.get(MatchmakingType.Match1v1)?.mapPoolOutdated ?? false,
  )
  const mapSelections = useMemo(() => [...(prefs.mapSelections ?? [])], [prefs.mapSelections])
  const mapPool = useAppSelector(s => s.matchmaking.mapPoolTypes.get(MatchmakingType.Match1v1)!)
  // TODO(tec27): Probably split the map previews into a separate component to prevent needing to
  // build this map at this level
  const mapsById = useAppSelector(s => {
    const result = new Map<string, Immutable<MapInfoJson>>()
    for (const mapId of mapSelections) {
      result.set(mapId, s.maps2.byId.get(mapId)!)
    }
    if (mapPool && mapPool.maps) {
      for (const mapId of mapPool.maps.values()) {
        result.set(mapId, s.maps2.byId.get(mapId)!)
      }
    }
    return result
  })

  const selfId = selfUser.id!
  const mapPoolId = mapPool?.id ?? 0
  const onPrefsChanged = useCallback(
    (model: Model1v1) => {
      dispatch(
        updateMatchmakingPreferences(
          MatchmakingType.Match1v1,
          model1v1ToPrefs(model, selfId, mapPoolId),
        ),
      )
    },
    [dispatch, mapPoolId, selfId],
  )
  const onFormSubmit = useCallback(
    (model: Model1v1) => {
      onSubmit(model1v1ToPrefs(model, selfId, mapPoolId))
    },
    [mapPoolId, onSubmit, selfId],
  )

  // TODO(tec27): Add a way to make map selections
  const mapSelectionItems = Range(0, 2).map(index => {
    const mapId = mapSelections[index]
    const map = mapId ? mapsById.get(mapId) : undefined
    return (
      <SelectedMap key={map?.id ?? `unselected-${index}`}>
        {map ? (
          <MapThumbnail map={map} showMapName={true} />
        ) : (
          <BrowseButton>
            <RandomContainer>
              <RandomIcon />
              <Subtitle2>Random map</Subtitle2>
            </RandomContainer>
          </BrowseButton>
        )}
      </SelectedMap>
    )
  })

  return (
    <>
      <Form1v1
        ref={formRef}
        model={{
          race: prefs.race ?? 'r',
          useAlternateRace: prefs.data?.useAlternateRace ?? false,
          alternateRace: prefs.data?.alternateRace ?? 'z',
          mapSelections,
        }}
        onChange={onPrefsChanged}
        onSubmit={onFormSubmit}
      />
      <MapSelectionsContainer>
        <MapSelectionsHeader>
          <SectionTitle>Preferred maps</SectionTitle>
          {mapPoolOutdated ? <OutdatedIndicator>Map pool changed</OutdatedIndicator> : null}
        </MapSelectionsHeader>
        <DescriptionText>
          Select up to 2 maps to be used in the per-match map pool. Your selections will be combined
          with your opponent’s to form the 4 map pool. Any unused selections will be replaced with a
          random map choice for each match.
        </DescriptionText>
        <MapSelections>{mapSelectionItems}</MapSelections>
      </MapSelectionsContainer>
    </>
  )
}

interface Model2v2 {
  race: RaceChar
}

interface Form2v2Props {
  model: Model2v2
  onChange: (model: Model2v2) => void
  onSubmit: (model: Model2v2) => void
}

// TODO(tec27): Use this form
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const FindMatch2v2Form = React.forwardRef<FormRef, Form2v2Props>((props, ref) => {
  const { onSubmit: handleSubmit, bindCustom } = useForm<Model2v2>(
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

// TODO(tec27): Remove this once 3v3 is added as a "real" matchmaking type
type ExpandedMatchmakingType = MatchmakingType | '3v3'

interface FindMatchProps {
  type: ExpandedMatchmakingType
  mapSelections: List<MapInfoJson>
}

export function FindMatch(props: FindMatchProps) {
  const lastQueuedMatchmakingType = useAppSelector(
    s => s.matchmakingPreferences.lastQueuedMatchmakingType,
  )
  const [activeTab, setActiveTab] = useState(props.type ?? lastQueuedMatchmakingType)

  const dispatch = useAppDispatch()
  const isMatchmakingEnabled = useAppSelector(
    s => s.matchmakingStatus.types.get(activeTab)?.enabled ?? false,
  )

  const [, isAtBottom, topElem, bottomElem] = useScrollIndicatorState({
    refreshToken: activeTab,
  })
  const formRef = useRef<FormRef>(null)

  const onSubmit = useCallback(
    (prefs: Immutable<MatchmakingPreferences>) => {
      if (activeTab === '3v3') {
        return
      }
      dispatch(findMatch(activeTab, prefs))
      dispatch(closeOverlay() as any)
    },
    [activeTab, dispatch],
  )

  const onFindClick = useCallback(() => {
    formRef.current?.submit()
  }, [])

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

  let contents: React.ReactNode | undefined
  switch (activeTab) {
    case MatchmakingType.Match1v1:
      contents = (
        <Contents1v1 formRef={formRef} onSubmit={onSubmit} mapSelections={props.mapSelections} />
      )
      break
    case MatchmakingType.Match2v2:
    case '3v3':
      // TODO(tec27): Build UIs for these
      contents = undefined
      break
    default:
      contents = assertUnreachable(activeTab)
  }

  return (
    <Container>
      <TitleBar>
        <Headline5>Find match</Headline5>
      </TitleBar>
      <Tabs bottomDivider={true} activeTab={activeTab} onChange={setActiveTab}>
        <TabItem text='1 vs 1' value={MatchmakingType.Match1v1} />
        <TabItem text='2 vs 2' value={MatchmakingType.Match2v2} />
        <TabItem text='3 vs 3' value={'3v3'} />
      </Tabs>

      {contents ? (
        <>
          <KeyListener onKeyDown={onKeyDown} />
          <Contents>
            {topElem}
            <ContentsBody>{contents}</ContentsBody>
            {bottomElem}
          </Contents>
          <Actions>
            <ScrollDivider show={!isAtBottom} />
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
