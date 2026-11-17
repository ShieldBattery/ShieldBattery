import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { graphql } from '../gql'
import { MapKind } from '../gql/graphql'
import { MaterialIcon } from '../icons/material/material-icon'
import { LoadErrorRow } from '../lists/load-error-row'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { FilterChip } from '../material/filter-chip'
import { Tooltip } from '../material/tooltip'
import { LoadingDotsArea } from '../progress/dots'
import { bodyLarge, bodySmall } from '../styles/typography'
import { errorCode } from './map-owner-actions'
import {
  mapTagLabel,
  MapTagNames,
  MAX_MAP_TAGS,
  sameTags,
  tagChipStates,
  tagEditErrorText,
  toggleMapTag,
  useMapTagList,
} from './map-tags'

const MapTagsDialogFamilyQuery = graphql(/* GraphQL */ `
  query MapTagsDialogFamily($id: UUID!) {
    mapFamily(id: $id) {
      id
      family {
        id
        current {
          id
          kind
        }
        tags {
          id
          kind
        }
        lockedTagIds
        canEditTags
      }
    }
  }
`)

/** Selects what the map's page and this dialog show about the map's tags, so both update. */
const MapSetTagsMutation = graphql(/* GraphQL */ `
  mutation MapFamilySetTags($mapId: SbMapId!, $tags: [String!]!) {
    mapFamilySetTags(mapId: $mapId, tags: $tags) {
      id
      tags {
        id
        kind
        name
        names {
          locale
          name
        }
      }
      lockedTagIds
      canEditTags
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

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`

const CountText = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

/**
 * Toggle chips picking a map's tags among `options`, in that order: at most {@link MAX_MAP_TAGS},
 * and never removing a locked one.
 */
export function MapTagToggleChips({
  options,
  selected,
  locked = [],
  disabled = false,
  onChange,
}: {
  options: ReadonlyArray<{ id: string } & MapTagNames>
  selected: ReadonlyArray<string>
  locked?: ReadonlyArray<string>
  disabled?: boolean
  onChange: (selected: string[]) => void
}) {
  const { t, i18n } = useTranslation()
  const optionIds = options.map(tag => tag.id)
  return (
    <ChipRow>
      {tagChipStates(optionIds, selected, locked).map((chip, i) => {
        const label = mapTagLabel(options[i], i18n.language)
        return chip.locked ? (
          <Tooltip
            key={chip.id}
            text={t('maps.tags.lockedTooltip', "You can't remove this tag")}
            position='bottom'>
            <FilterChip
              label={label}
              selected={true}
              disabled={true}
              icon={<MaterialIcon icon='lock' size={18} />}
            />
          </Tooltip>
        ) : (
          <FilterChip
            key={chip.id}
            label={label}
            selected={chip.selected}
            disabled={disabled || chip.disabled}
            onClick={() => onChange(toggleMapTag(optionIds, selected, chip.id, locked))}
          />
        )
      })}
    </ChipRow>
  )
}

/** What the Edit tags dialog needs to know about a map. */
export interface TagsDialogFamily {
  /** The kind of the map's recommended file, which the tags offered are for. */
  kind: MapKind
  /** The map's tags, in list order. */
  tags: ReadonlyArray<string>
  /** The tags the viewer can't remove. */
  lockedTagIds: ReadonlyArray<string>
  canEditTags: boolean
}

export interface MapTagsDialogContentsProps {
  family: TagsDialogFamily
  /** The server's list of tags, once loaded. */
  tagList?: ReadonlyArray<{ id: string; kind: MapKind } & MapTagNames>
  /** Whether a save is being sent. */
  saving: boolean
  /** Why the last save failed, if it did. */
  errorMessage?: string
  /** Saves `tags` as every tag the map should have. */
  onSave: (tags: string[]) => void
  onCancel: () => void
}

/** The Edit tags dialog once it knows the map: the tags of its kind to pick from, and saving them. */
export function MapTagsDialogContents({
  family,
  tagList,
  saving,
  errorMessage,
  onSave,
  onCancel,
}: MapTagsDialogContentsProps) {
  const { t } = useTranslation()
  // Follows the map's tags until the user picks some
  const [picked, setPicked] = useState<string[]>()
  const selected = picked ?? family.tags
  const options = tagList?.filter(tag => tag.kind === family.kind)
  const changed = !sameTags(selected, family.tags)

  const buttons = [
    <TextButton key='cancel' label={t('common.actions.cancel', 'Cancel')} onClick={onCancel} />,
    <TextButton
      key='save'
      label={t('common.actions.save', 'Save')}
      disabled={!changed || saving || !family.canEditTags || !options}
      onClick={() => onSave([...selected])}
    />,
  ]

  return (
    <StyledDialog
      title={t('maps.tags.editTitle', 'Edit tags')}
      buttons={buttons}
      onCancel={onCancel}
      showCloseButton={true}>
      <Layout>
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        {options ? (
          <>
            <MapTagToggleChips
              options={options}
              selected={selected}
              locked={family.lockedTagIds}
              disabled={saving || !family.canEditTags}
              onChange={setPicked}
            />
            <CountText>
              {t('maps.tags.selectedCount', '{{selected}} of {{max}}', {
                selected: selected.length,
                max: MAX_MAP_TAGS,
              })}
            </CountText>
          </>
        ) : (
          <LoadingDotsArea />
        )}
      </Layout>
    </StyledDialog>
  )
}

export interface MapTagsDialogProps extends CommonDialogProps {
  /** The map whose tags are edited. */
  familyId: string
}

/** Sets which tags a map has. */
export function MapTagsDialog({ familyId, onCancel, close }: MapTagsDialogProps) {
  const { t } = useTranslation()
  const [{ data, error }, refetch] = useQuery({
    query: MapTagsDialogFamilyQuery,
    variables: { id: familyId },
    // Which tags the viewer may remove depends on who set them, which others change
    requestPolicy: 'network-only',
    context: NO_SUSPENSE_CONTEXT,
  })
  const tagList = useMapTagList()
  const [{ fetching: saving }, setTags] = useMutation(MapSetTagsMutation)
  const [errorMessage, setErrorMessage] = useState<string>()
  // Changing this starts the picks over from the map's tags
  const [picksKey, setPicksKey] = useState(0)

  const family = data?.mapFamily?.family
  const title = t('maps.tags.editTitle', 'Edit tags')
  if (!family) {
    return (
      <StyledDialog title={title} onCancel={onCancel} showCloseButton={true}>
        {error || data ? (
          <LoadErrorRow
            message={t('maps.page.loadError', "Couldn't load this map")}
            onRetry={() => refetch({ requestPolicy: 'network-only' })}
          />
        ) : (
          <LoadingDotsArea />
        )}
      </StyledDialog>
    )
  }

  const onSave = (tags: string[]) => {
    setErrorMessage(undefined)
    setTags({ mapId: family.current.id, tags })
      .then(result => {
        if (result.error || !result.data) {
          const code = result.error ? errorCode(result.error) : undefined
          setErrorMessage(tagEditErrorText(code, t))
          // The map's tags or who may change them changed meanwhile: show them as they are now
          if (code === 'TAG_LOCKED' || code === 'FORBIDDEN') {
            setPicksKey(k => k + 1)
            refetch({ requestPolicy: 'network-only' })
          }
          return
        }
        close()
      })
      .catch(swallowNonBuiltins)
  }

  return (
    <MapTagsDialogContents
      key={picksKey}
      family={{
        kind: family.current.kind,
        tags: family.tags.map(tag => tag.id),
        lockedTagIds: family.lockedTagIds,
        canEditTags: family.canEditTags,
      }}
      tagList={tagList}
      saving={saving}
      errorMessage={errorMessage}
      onSave={onSave}
      onCancel={onCancel}
    />
  )
}
