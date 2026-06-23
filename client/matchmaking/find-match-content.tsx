import { Immutable } from 'immer'
import { useMemo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { ReadonlyDeep } from 'type-fest'
import { SbMapId } from '../../common/maps'
import {
  getMatchmakingModeInfo,
  MatchmakingPreferences,
  MatchmakingPreferencesData1v1,
  MatchmakingType,
} from '../../common/matchmaking'
import { MatchmakingMapPoolJson } from '../../common/matchmaking/matchmaking-map-pools'
import { AssignedRaceChar, RaceChar } from '../../common/races'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { RacePickerSize } from '../lobbies/race-picker'
import { CheckBox } from '../material/check-box'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { updateMatchmakingPreferences } from './action-creators'
import {
  DescriptionText,
  FixedMapDisplay,
  MapSelectionControl,
  MapSelectionsHeader,
  MapVetoesControl,
  OutdatedIndicator,
  SectionTitle,
  StyledRaceSelect,
  VetoDescriptionText,
} from './find-match-forms'

/**
 * The unified editing model for any matchmaking mode. `useAlternateRace`/`alternateRace` are only
 * meaningful for modes whose descriptor has `supportsAlternateRace`; they're ignored otherwise.
 */
interface FindMatchModel {
  race: RaceChar
  mapSelections: SbMapId[]
  useAlternateRace: boolean
  alternateRace: AssignedRaceChar
}

interface FindMatchFormProps {
  type: MatchmakingType
  disabled: boolean
  model: FindMatchModel
  mapPool?: ReadonlyDeep<MatchmakingMapPoolJson>
  mapPoolOutdated: boolean
  onValidatedChange: (model: ReadonlyDeep<FindMatchModel>) => void
}

/**
 * A single, descriptor-driven settings form that renders the right controls for any matchmaking
 * mode: race selection (plus an alternate-race option for modes that support it), and the map
 * control matching the mode's `mapSelectionStyle` (veto / pick / fixed).
 */
function FindMatchForm({
  type,
  disabled,
  model,
  mapPool,
  mapPoolOutdated,
  onValidatedChange,
}: FindMatchFormProps) {
  const { t } = useTranslation()
  const mode = getMatchmakingModeInfo(type)
  const { submit, bindCheckable, bindCustom, getInputValue, form } = useForm<FindMatchModel>(
    model,
    {},
  )

  useFormCallbacks(form, { onValidatedChange })

  const race = getInputValue('race')
  const canUseAlternateRace = mode.supportsAlternateRace && race !== 'r'
  const useAlternateRace = canUseAlternateRace ? getInputValue('useAlternateRace') : false
  const hiddenAlternateRaces = race !== 'r' ? [race] : []

  return (
    <form noValidate={true} onSubmit={submit}>
      <SectionTitle>{t('matchmaking.findMatch.race', 'Race')}</SectionTitle>
      <StyledRaceSelect
        {...bindCustom('race')}
        size={RacePickerSize.Large}
        allowInteraction={!disabled}
      />
      {canUseAlternateRace ? (
        <CheckBox
          {...bindCheckable('useAlternateRace')}
          label={t(
            'matchmaking.findMatch.useAlternateRace',
            'Use alternate race to avoid mirror matchups',
          )}
          disabled={disabled}
        />
      ) : null}
      {useAlternateRace ? (
        <>
          <SectionTitle>{t('matchmaking.findMatch.alternateRace', 'Alternate race')}</SectionTitle>
          <DescriptionText>
            {t(
              'matchmaking.findMatch.description',
              'Select a race to be used whenever your opponent has selected the same primary race.',
            )}
          </DescriptionText>
          <StyledRaceSelect
            {...bindCustom('alternateRace')}
            hiddenRaces={hiddenAlternateRaces}
            size={RacePickerSize.Large}
            allowRandom={false}
            allowInteraction={!disabled}
          />
        </>
      ) : null}
      {mapPool ? (
        <>
          <MapSelectionsHeader>
            <SectionTitle>{t('matchmaking.findMatch.mapPool', 'Map pool')}</SectionTitle>
            {mapPoolOutdated ? (
              <OutdatedIndicator>{t('matchmaking.findMatch.updated', 'Updated')}</OutdatedIndicator>
            ) : null}
          </MapSelectionsHeader>

          {(() => {
            switch (mode.mapSelectionStyle) {
              case 'veto':
                return (
                  <>
                    <VetoDescriptionText
                      maxVetoCount={mapPool.maxVetoCount}
                      mapPoolSize={mapPool.maps.length}
                      numberOfPlayers={mode.teamSize * 2}
                    />
                    <MapVetoesControl
                      {...bindCustom('mapSelections')}
                      mapPool={mapPool}
                      disabled={disabled}
                    />
                  </>
                )
              case 'pick':
                return (
                  <>
                    <DescriptionText>
                      <Trans t={t} i18nKey='matchmaking.findMatch.mapSelectionDescription'>
                        Select the maps you would like to play on. Only selected maps will be
                        chosen.
                      </Trans>
                    </DescriptionText>
                    <MapSelectionControl
                      {...bindCustom('mapSelections')}
                      mapPool={mapPool}
                      disabled={disabled}
                    />
                  </>
                )
              case 'fixed':
                return (
                  <>
                    <DescriptionText>
                      {t(
                        'matchmaking.findMatch.fixedMapDescription',
                        'This mode is always played on a fixed map.',
                      )}
                    </DescriptionText>
                    <FixedMapDisplay mapPool={mapPool} />
                  </>
                )
              default:
                return mode.mapSelectionStyle satisfies never
            }
          })()}
        </>
      ) : (
        <LoadingDotsArea />
      )}
    </form>
  )
}

function buildPreferences(
  type: MatchmakingType,
  model: ReadonlyDeep<FindMatchModel>,
  userId: SbUserId,
  mapPoolId: number,
): MatchmakingPreferences {
  const mode = getMatchmakingModeInfo(type)
  // The discriminant (`matchmakingType`) is only known at runtime here, so the union can't be
  // constructed without a cast; the descriptor decides which `data` shape is correct.
  return {
    userId,
    matchmakingType: type,
    race: model.race,
    mapPoolId,
    mapSelections: model.mapSelections,
    data: mode.supportsAlternateRace
      ? {
          useAlternateRace: model.race !== 'r' ? model.useAlternateRace : false,
          alternateRace: model.alternateRace,
        }
      : {},
  } as MatchmakingPreferences
}

export interface FindMatchContentProps {
  type: MatchmakingType
  disabled: boolean
}

/**
 * Redux-connected settings content for a single matchmaking mode, used in the find-match settings
 * drawer. Reads the player's stored preferences for `type` and persists edits as they're made.
 */
export function FindMatchContent({ type, disabled }: FindMatchContentProps) {
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()!
  const prefs = useAppSelector(
    s =>
      s.matchmakingPreferences.byType.get(type)?.preferences as
        | Immutable<MatchmakingPreferences>
        | undefined,
  )
  const mapPoolOutdated = useAppSelector(
    s => s.matchmakingPreferences.byType.get(type)?.mapPoolOutdated ?? false,
  )
  const mapPool = useAppSelector(s => s.mapPools.byType.get(type))
  const prefsMapSelections = prefs?.mapSelections
  const mapSelections = useMemo(
    () => (prefsMapSelections ?? []).filter(id => !mapPool || mapPool.maps.includes(id)),
    [prefsMapSelections, mapPool],
  )

  const selfId = selfUser.id
  const mapPoolId = mapPool?.id ?? 0

  if (!prefs) {
    return <LoadingDotsArea />
  }

  const data = prefs.data as Immutable<MatchmakingPreferencesData1v1> | undefined
  const race = prefs.race ?? 'r'

  return (
    <FindMatchForm
      type={type}
      disabled={disabled}
      model={{
        race,
        useAlternateRace: data?.useAlternateRace ?? false,
        alternateRace: data?.alternateRace ?? 'z',
        mapSelections,
      }}
      mapPool={mapPool}
      mapPoolOutdated={mapPoolOutdated}
      onValidatedChange={model => {
        if (disabled) {
          return
        }
        dispatch(
          updateMatchmakingPreferences(type, buildPreferences(type, model, selfId, mapPoolId)),
        )
      }}
    />
  )
}
