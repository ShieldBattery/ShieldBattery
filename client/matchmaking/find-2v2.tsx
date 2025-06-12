import { Immutable } from 'immer'
import { forwardRef, useImperativeHandle, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ReadonlyDeep } from 'type-fest'
import {
  MatchmakingMapPool,
  MatchmakingPreferences2v2,
  MatchmakingType,
} from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { RacePickerSize } from '../lobbies/race-picker'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { updateMatchmakingPreferences } from './action-creators'
import {
  FindMatchContentsProps,
  FindMatchFormRef,
  MapSelectionsHeader,
  MapVetoesControl,
  OutdatedIndicator,
  SectionTitle,
  StyledRaceSelect,
  VetoDescriptionText,
} from './find-match-forms'

interface Model2v2 {
  race: RaceChar
  mapSelections: string[]
}

interface Form2v2Props {
  disabled: boolean
  model: Model2v2
  mapPool?: Immutable<MatchmakingMapPool>
  mapPoolOutdated: boolean
  onValidatedChange: (model: ReadonlyDeep<Model2v2>) => void
  onSubmit: (model: ReadonlyDeep<Model2v2>) => void
}

const Form2v2 = forwardRef<FindMatchFormRef, Form2v2Props>(
  ({ disabled, model, mapPoolOutdated, mapPool, onValidatedChange, onSubmit }, ref) => {
    const { t } = useTranslation()
    const { submit: handleSubmit, bindCustom, form } = useForm<Model2v2>(model, {})

    useFormCallbacks(form, {
      onValidatedChange,
      onSubmit,
      // other callbacks that were previously in the third parameter
    })

    useImperativeHandle(ref, () => ({
      submit: handleSubmit,
    }))

    return (
      <form noValidate={true} onSubmit={handleSubmit}>
        <SectionTitle>{t('matchmaking.findMatch.race', 'Race')}</SectionTitle>
        <StyledRaceSelect
          {...bindCustom('race')}
          size={RacePickerSize.Large}
          allowInteraction={!disabled}
        />
        {mapPool ? (
          <>
            <MapSelectionsHeader>
              <SectionTitle>{t('matchmaking.findMatch.mapPool', 'Map pool')}</SectionTitle>
              {mapPoolOutdated ? (
                <OutdatedIndicator>
                  {t('matchmaking.findMatch.updated', 'Updated')}
                </OutdatedIndicator>
              ) : null}
            </MapSelectionsHeader>

            <VetoDescriptionText
              maxVetoCount={mapPool.maxVetoCount}
              mapPoolSize={mapPool.maps.length}
              numberOfPlayers={4}
            />
            <MapVetoesControl
              {...bindCustom('mapSelections')}
              mapPool={mapPool}
              disabled={disabled}
            />
          </>
        ) : (
          <LoadingDotsArea />
        )}
      </form>
    )
  },
)

function model2v2ToPrefs(model: ReadonlyDeep<Model2v2>, userId: SbUserId, mapPoolId: number) {
  return {
    userId,
    matchmakingType: MatchmakingType.Match2v2 as const,
    race: model.race,
    mapPoolId,
    mapSelections: model.mapSelections,
    data: {},
  }
}

export function Contents2v2({ formRef, onSubmit, disabled }: FindMatchContentsProps) {
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()!
  const prefs = useAppSelector(
    s =>
      s.matchmakingPreferences.byType.get(MatchmakingType.Match2v2)?.preferences as
        | Immutable<MatchmakingPreferences2v2>
        | Record<string, never>
        | undefined,
  )
  const mapPoolOutdated = useAppSelector(
    s => s.matchmakingPreferences.byType.get(MatchmakingType.Match2v2)?.mapPoolOutdated ?? false,
  )
  const mapPool = useAppSelector(s => s.mapPools.byType.get(MatchmakingType.Match2v2))
  const mapSelections = useMemo(
    () => (prefs?.mapSelections ?? []).filter(id => !mapPool || mapPool.maps.includes(id)),
    [prefs?.mapSelections, mapPool],
  )

  const selfId = selfUser.id
  const mapPoolId = mapPool?.id ?? 0

  return prefs ? (
    <Form2v2
      ref={formRef}
      disabled={disabled}
      model={{
        race: prefs.race ?? 'r',
        mapSelections,
      }}
      onValidatedChange={model => {
        if (disabled) {
          return
        }

        dispatch(
          updateMatchmakingPreferences(
            MatchmakingType.Match2v2,
            model2v2ToPrefs(model, selfId, mapPoolId),
          ),
        )
      }}
      onSubmit={model => {
        if (disabled) {
          return
        }

        onSubmit(model2v2ToPrefs(model, selfId, mapPoolId))
      }}
      mapPoolOutdated={mapPoolOutdated}
      mapPool={mapPool}
    />
  ) : (
    <LoadingDotsArea />
  )
}
