import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { MapFeatureDialogData, MapFeatureRemoveDialogData } from '../dialogs/dialog-type'
import { graphql, useFragment } from '../gql'
import { MapKind } from '../gql/graphql'
import { LoadErrorRow } from '../lists/load-error-row'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { TextField } from '../material/text-field'
import { LoadingDotsArea } from '../progress/dots'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium } from '../styles/typography'
import {
  featureErrorText,
  featureKindLabel,
  featurePickName,
  MapFeaturePick_FeatureFragment,
  MapFeatureSetMutation,
} from './map-feature-actions'
import {
  featureWeekOptions,
  formatDayMonth,
  formatWeekRange,
  initialFeatureWeek,
  MAX_FEATURE_BLURB_LENGTH,
  replacesText,
  takenWeeks,
} from './map-feature-weeks'
import { errorCode } from './map-owner-actions'

// Only staff pick features, so these dialogs aren't translated.

/**
 * How many of the latest picks the dialog loads: the most a page can hold. Picks can be made at
 * most 26 weeks ahead, two per week, so every pick from this week on is among them.
 */
const SCHEDULE_PAGE_SIZE = 100

/** The picks the dialog checks the weeks it offers against. */
const MapFeatureDialogWeeksQuery = graphql(/* GraphQL */ `
  query MapFeatureDialogWeeks($first: Int!) {
    mapFeatures(first: $first) {
      edges {
        node {
          id
          ...MapFeaturePick_FeatureFragment
        }
      }
    }
  }
`)

/** Requests results without suspending: the dialog renders its own loading state. */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

const WeekField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const ReplacesText = styled.div`
  ${bodyMedium};
  padding-inline: 12px;
  color: var(--theme-on-surface-variant);
`

const BodyText = styled.div`
  ${bodyLarge};
`

const KINDS = [MapKind.Melee, MapKind.Ums]

/**
 * Makes a map or a collection the staff pick of one of a week's slots, or changes the blurb of a
 * slot's pick. A map goes in the slot of its kind; a collection in the one staff choose.
 */
export function MapFeatureDialog({
  target,
  week: fixedWeek,
  blurb: initialBlurb,
  onCancel,
  close,
}: MapFeatureDialogData & CommonDialogProps) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [{ data, error }, refetch] = useQuery({
    query: MapFeatureDialogWeeksQuery,
    variables: { first: SCHEDULE_PAGE_SIZE },
    // Other staff change the schedule, so the weeks it offers are checked against the latest one
    requestPolicy: 'network-only',
    context: NO_SUSPENSE_CONTEXT,
  })
  const [{ fetching: saving }, setFeature] = useMutation(MapFeatureSetMutation)
  // When the dialog opened is recent enough to tell the current week by
  const [now] = useState(() => Date.now())
  const [chosenKind, setChosenKind] = useState<MapKind>()
  const [chosenWeek, setChosenWeek] = useState<string>()
  // Follows the chosen week's blurb until staff type their own
  const [typedBlurb, setTypedBlurb] = useState<string>()
  const [errorMessage, setErrorMessage] = useState<string>()

  const picks = useFragment(
    MapFeaturePick_FeatureFragment,
    data?.mapFeatures.edges.map(e => e.node) ?? [],
  )
  const kind = target.kind ?? chosenKind
  const taken = takenWeeks(picks, kind, pick => ({
    name: featurePickName(pick, t),
    sameTarget:
      'collectionId' in target
        ? pick.collection?.id === target.collectionId
        : pick.map?.family.id === target.familyId,
  }))

  const title =
    'collectionId' in target
      ? 'Feature as collection of the week'
      : `Feature as ${featureKindLabel(target.kind)} map of the week`
  const fixedValue = fixedWeek ? new Date(fixedWeek).toISOString() : undefined
  const options = fixedValue
    ? [
        {
          value: fixedValue,
          week: new Date(fixedValue),
          label: formatWeekRange(new Date(fixedValue)),
          taken: taken.get(Date.parse(fixedValue)),
        },
      ]
    : featureWeekOptions(now, taken)
  const weekValue = chosenWeek ?? initialFeatureWeek(options, fixedValue)
  const option = options.find(o => o.value === weekValue)
  const sameTargetBlurb = option?.taken?.sameTarget ? option.taken.blurb : undefined
  const blurb = typedBlurb ?? sameTargetBlurb ?? initialBlurb ?? ''
  // Counted in characters, as the server counts them
  const blurbTooLong = Array.from(blurb.trim()).length > MAX_FEATURE_BLURB_LENGTH
  const replaces = replacesText(option)

  if (!data) {
    return (
      <StyledDialog title={title} onCancel={onCancel} showCloseButton={true}>
        {error ? (
          <LoadErrorRow
            message="Couldn't load the schedule"
            onRetry={() => refetch({ requestPolicy: 'network-only' })}
          />
        ) : (
          <LoadingDotsArea />
        )}
      </StyledDialog>
    )
  }

  const onSave = () => {
    if (!kind || !weekValue || saving || blurbTooLong) {
      return
    }
    setErrorMessage(undefined)
    setFeature({
      week: weekValue,
      kind,
      mapId: 'mapId' in target ? target.mapId : undefined,
      collectionId: 'collectionId' in target ? target.collectionId : undefined,
      blurb: blurb.trim(),
    })
      .then(result => {
        if (result.error || !result.data) {
          setErrorMessage(featureErrorText(result.error ? errorCode(result.error) : undefined))
          return
        }
        close()
        snackbarController.showSnackbar(
          `Featured ${target.name} for the week of ${formatDayMonth(new Date(weekValue))}`,
        )
      })
      .catch(swallowNonBuiltins)
  }

  const buttons = [
    <TextButton key='cancel' label='Cancel' onClick={onCancel} />,
    <TextButton
      key='save'
      label='Save'
      disabled={saving || !kind || !weekValue || blurbTooLong}
      onClick={onSave}
    />,
  ]

  return (
    <StyledDialog title={title} buttons={buttons} onCancel={onCancel} showCloseButton={true}>
      <Layout>
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        <BodyText>{target.name}</BodyText>
        {'collectionId' in target ? (
          <Select
            label='Show under'
            value={kind}
            allowErrors={false}
            disabled={!!target.kind || saving}
            onChange={(value: MapKind) => setChosenKind(value)}>
            {KINDS.map(k => (
              <SelectOption key={k} value={k} text={featureKindLabel(k)} />
            ))}
          </Select>
        ) : null}
        <WeekField>
          <Select
            label='Week'
            value={weekValue}
            allowErrors={false}
            disabled={!!fixedValue || saving}
            onChange={(value: string) => setChosenWeek(value)}>
            {options.map(o => (
              <SelectOption key={o.value} value={o.value} text={o.label} />
            ))}
          </Select>
          {replaces ? <ReplacesText>{replaces}</ReplacesText> : null}
        </WeekField>
        <TextField
          label='Blurb'
          value={blurb}
          maxLength={MAX_FEATURE_BLURB_LENGTH}
          allowErrors={false}
          disabled={saving}
          onChange={event => setTypedBlurb(event.target.value)}
          onEnterKeyDown={onSave}
        />
      </Layout>
    </StyledDialog>
  )
}

/** Confirms removing the staff pick of one of a week's slots. */
export function MapFeatureRemoveDialog({
  weekText,
  kind,
  name,
  onConfirm,
  onCancel,
  close,
}: MapFeatureRemoveDialogData & CommonDialogProps) {
  const buttons = [
    <TextButton key='cancel' label='Cancel' onClick={onCancel} />,
    <TextButton
      key='remove'
      label='Remove'
      onClick={() => {
        close()
        onConfirm()
      }}
    />,
  ]

  return (
    <StyledDialog title='Remove the pick' buttons={buttons} onCancel={onCancel}>
      <BodyText>{`Remove ${name} as the ${featureKindLabel(kind)} pick for ${weekText}? That slot gets the automatic pick unless another is set.`}</BodyText>
    </StyledDialog>
  )
}
