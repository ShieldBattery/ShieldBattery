import { TFunction } from 'i18next'
import * as React from 'react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CombinedError, useMutation, useQuery } from 'urql'
import { Link } from 'wouter'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { urlForMapCompare } from '../../common/map-url'
import { filterColorCodes, SbMapId } from '../../common/maps'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { FragmentType, graphql, useFragment } from '../gql'
import {
  MapPublish_FileFragmentFragment,
  MapPublish_SuggestionFragmentFragment,
  MapPublishAnswerKind,
  MapPublishBlockedReason,
} from '../gql/graphql'
import { TransInterpolation } from '../i18n/i18next'
import { LoadErrorRow } from '../lists/load-error-row'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { RadioButton, RadioGroup } from '../material/radio'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import {
  bodyLarge,
  bodyMedium,
  bodySmall,
  labelMedium,
  singleLine,
  titleSmall,
} from '../styles/typography'
import { urlForMapFile } from './map-family-files'
import { MapFileImage } from './map-image'
import { publishEvidenceText } from './map-publish'

/** A map suggested as the one a file is a version of, and how alike their files are. */
export const MapPublish_SuggestionFragment = graphql(/* GraphQL */ `
  fragment MapPublish_SuggestionFragment on MapPublishSuggestion {
    id
    similarity
    sameKind
    triggerSimilarity
    sameResources
    family {
      id
      name
    }
    file {
      id
      file {
        id
        ...MapFileImage_FileFragment
      }
    }
  }
`)

/** The file being published or linked. */
export const MapPublish_FileFragment = graphql(/* GraphQL */ `
  fragment MapPublish_FileFragment on SbMap {
    id
    name
    family {
      id
      name
      current {
        id
      }
    }
    file {
      id
      ...MapFileImage_FileFragment
    }
  }
`)

/** What publishing a file would do. */
export const MapPublish_PreviewFragment = graphql(/* GraphQL */ `
  fragment MapPublish_PreviewFragment on MapPublishPreview {
    id
    blockedReason
    needsReview
    existingMap {
      id
      name
    }
    suggestions {
      id
      ...MapPublish_SuggestionFragment
    }
  }
`)

const MapPublishPreviewQuery = graphql(/* GraphQL */ `
  query MapPublishPreview($fileId: SbMapId!) {
    mapPublishPreview(fileId: $fileId) {
      id
      ...MapPublish_PreviewFragment
    }
    # What the views of the file show about its listing, so they all catch up to it once the
    # preview loads
    map(id: $fileId) {
      id
      listed
      publishedAt
      official
      publisher {
        id
        name
      }
      ...MapPublish_FileFragment
    }
  }
`)

const MapLinkSuggestionsQuery = graphql(/* GraphQL */ `
  query MapLinkSuggestions($fileId: SbMapId!) {
    mapLinkSuggestions(fileId: $fileId) {
      id
      ...MapPublish_SuggestionFragment
    }
    map(id: $fileId) {
      id
      ...MapPublish_FileFragment
    }
  }
`)

const PublishMutation = graphql(/* GraphQL */ `
  mutation MapPublish($fileId: SbMapId!, $answer: MapPublishAnswerInput!) {
    mapPublish(fileId: $fileId, answer: $answer) {
      id
      heldForReview
      file {
        id
        listed
        publishedAt
        publisher {
          id
          name
        }
        family {
          id
          name
        }
      }
      family {
        id
        name
        current {
          id
        }
      }
    }
  }
`)

const LinkMutation = graphql(/* GraphQL */ `
  mutation MapFileLink($fileId: SbMapId!, $familyId: UUID!) {
    mapFileLink(fileId: $fileId, familyId: $familyId) {
      id
      file {
        id
        family {
          id
          name
        }
      }
      family {
        id
        name
        current {
          id
        }
      }
      previousFamily {
        id
      }
    }
  }
`)

type Suggestion = MapPublish_SuggestionFragmentFragment

/**
 * Requests results without suspending: the dialog renders its own loading state. Module-level so
 * the query sees the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

/** The radio value of the option saying the file isn't a version of any suggested map. */
const NONE_VALUE = 'none'

/** The longest map name the button joining a file to that map names it in. */
const MAX_JOIN_LABEL_NAME_LENGTH = 24

function genericErrorText(t: TFunction): string {
  return t('maps.publish.error', 'Something went wrong. Please try again later.')
}

/** Says why the current user can't publish a file. */
function blockedReasonText(reason: MapPublishBlockedReason, t: TFunction): string {
  switch (reason) {
    case MapPublishBlockedReason.AlreadyListed:
      return t('maps.publish.alreadyListed', 'This file is already published.')
    case MapPublishBlockedReason.Restricted:
      return t('maps.publish.restricted', "You're restricted from publishing maps.")
    case MapPublishBlockedReason.EmailUnverified:
      return t('maps.publish.emailUnverified', 'Verify your email address to publish maps.')
    case MapPublishBlockedReason.RateLimited:
      return t(
        'maps.publish.rateLimited',
        "You've published a lot of maps today. Try again tomorrow.",
      )
    case MapPublishBlockedReason.NotInLibrary:
      return t('maps.publish.notInLibrary', 'Add this file to your maps to publish it.')
    case MapPublishBlockedReason.EmptyName:
      return t('maps.publish.emptyName', "This file has no name, so it can't be published.")
    case MapPublishBlockedReason.StaffDelisted:
      return t(
        'maps.publish.staffDelisted',
        "Staff took this file out of the listings, so it can't be published.",
      )
    default:
      reason satisfies never
      return genericErrorText(t)
  }
}

function errorCode(error: CombinedError): unknown {
  return error.graphQLErrors[0]?.extensions?.code
}

function isBlockedReason(code: unknown): code is MapPublishBlockedReason {
  return Object.values<unknown>(MapPublishBlockedReason).includes(code)
}

/** What a failed publish or link tells the user. The server uses blocked reasons as codes. */
function submitErrorText(error: CombinedError, t: TFunction): string {
  const code = errorCode(error)
  if (code === 'NOT_SUGGESTED') {
    return t('maps.publish.notSuggested', 'That map is no longer suggested for this file.')
  } else if (isBlockedReason(code)) {
    return blockedReasonText(code, t)
  } else {
    return genericErrorText(t)
  }
}

const StyledDialog = styled(Dialog)`
  max-width: 560px;
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

const BodyText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface);
  overflow-wrap: anywhere;
`

const MutedText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const Pair = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 200px));
  justify-content: center;
  gap: 16px;
`

const PairSide = styled.div`
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const PairImage = styled.div`
  width: 100%;
  aspect-ratio: 1;
  margin-bottom: 4px;
  overflow: hidden;

  border-radius: 6px;
  background-color: var(--theme-container-low);
`

const PairLabel = styled.div`
  ${labelMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const PairName = styled.div`
  ${titleSmall};
  ${singleLine};
  color: var(--theme-on-surface);
`

const EvidenceLine = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  text-align: center;
`

/** Sits over the radio button's input, which otherwise takes every click on its row. */
const CompareLink = styled(Link)`
  position: relative;
  z-index: 1;
`

const SuggestionRow = styled.div`
  width: 100%;
  min-width: 0;
  padding-block: 4px;

  display: flex;
  align-items: center;
  gap: 12px;
`

const SuggestionImage = styled.div`
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  overflow: hidden;

  border-radius: 4px;
  background-color: var(--theme-container-low);
`

const SuggestionText = styled.div`
  flex: 1 1 auto;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

const SuggestionName = styled.div`
  ${titleSmall};
  ${singleLine};
`

const SuggestionMeta = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

/** Why a map is suggested, and a link comparing its file with the file being published. */
function Evidence({
  suggestion,
  fileId,
  close,
}: {
  suggestion: Suggestion
  fileId: SbMapId
  close: () => void
}) {
  const { t } = useTranslation()
  return (
    <>
      {publishEvidenceText(suggestion, t)}
      {' · '}
      <CompareLink href={urlForMapCompare(suggestion.file.id, fileId)} onClick={close}>
        {t('maps.files.compare', 'Compare')}
      </CompareLink>
    </>
  )
}

/** A suggested map as a row of a radio list: its file's image, its name and the evidence. */
function SuggestionOption({
  suggestion,
  fileId,
  close,
}: {
  suggestion: Suggestion
  fileId: SbMapId
  close: () => void
}) {
  const name = filterColorCodes(suggestion.family.name)
  return (
    <SuggestionRow>
      <SuggestionImage>
        <MapFileImage file={suggestion.file.file} name={name} size={64} forceAspectRatio={1} />
      </SuggestionImage>
      <SuggestionText>
        <SuggestionName>{name}</SuggestionName>
        <SuggestionMeta>
          <Evidence suggestion={suggestion} fileId={fileId} close={close} />
        </SuggestionMeta>
      </SuggestionText>
    </SuggestionRow>
  )
}

/**
 * The suggested maps to pick from, by their map's id, plus (with `noneLabel`) an option saying
 * it's none of them.
 */
function SuggestionList({
  suggestions,
  fileId,
  value,
  noneLabel,
  disabled,
  onChange,
  close,
}: {
  suggestions: ReadonlyArray<Suggestion>
  fileId: SbMapId
  value: string | undefined
  noneLabel?: string
  disabled: boolean
  onChange: (value: string) => void
  close: () => void
}) {
  return (
    <RadioGroup value={value} dense={true} onChange={e => onChange(e.target.value)}>
      {[
        ...suggestions.map(s => (
          <RadioButton
            key={s.family.id}
            value={s.family.id}
            label={<SuggestionOption suggestion={s} fileId={fileId} close={close} />}
            disabled={disabled}
          />
        )),
        noneLabel ? (
          <RadioButton key={NONE_VALUE} value={NONE_VALUE} label={noneLabel} disabled={disabled} />
        ) : null,
      ]}
    </RadioGroup>
  )
}

/** The file being published next to the one suggested map's file. */
function SuggestionPair({
  file,
  suggestion,
  close,
}: {
  file: MapPublish_FileFragmentFragment
  suggestion: Suggestion
  close: () => void
}) {
  const { t } = useTranslation()
  const fileName = filterColorCodes(file.name)
  const mapName = filterColorCodes(suggestion.family.name)
  return (
    <>
      <Pair>
        <PairSide>
          <PairImage>
            <MapFileImage file={file.file} name={fileName} size={256} forceAspectRatio={1} />
          </PairImage>
          <PairLabel>{t('maps.publish.yourFile', 'Your file')}</PairLabel>
          <PairName>{fileName}</PairName>
        </PairSide>
        <PairSide>
          <PairImage>
            <MapFileImage
              file={suggestion.file.file}
              name={mapName}
              size={256}
              forceAspectRatio={1}
            />
          </PairImage>
          <PairLabel>{t('maps.publish.inCatalog', 'In the catalog')}</PairLabel>
          <PairName>{mapName}</PairName>
        </PairSide>
      </Pair>
      <EvidenceLine>
        <Evidence suggestion={suggestion} fileId={file.id} close={close} />
      </EvidenceLine>
    </>
  )
}

/** How the publisher answers whether a file is a version of a suggested map. */
export interface PublishAnswer {
  kind: MapPublishAnswerKind
  /** The suggested map the answer is about. Unset for `KEEP`. */
  family?: { id: string; name: string }
}

export interface PublishDialogContentsProps {
  preview: FragmentType<typeof MapPublish_PreviewFragment>
  file: FragmentType<typeof MapPublish_FileFragment>
  /** Whether a publish is being sent. */
  sending: boolean
  /** Why the last publish failed, if it did. */
  errorMessage?: string
  onPublish: (answer: PublishAnswer) => void
  onCancel: () => void
  close: () => void
}

/**
 * What the publish dialog shows for a file once it knows what publishing it would do: why it can't
 * be published, or the question of whether it's a version of a map that's already listed.
 */
export function PublishDialogContents({
  preview: previewRef,
  file: fileRef,
  sending,
  errorMessage,
  onPublish,
  onCancel,
  close,
}: PublishDialogContentsProps) {
  const { t } = useTranslation()
  const preview = useFragment(MapPublish_PreviewFragment, previewRef)
  const file = useFragment(MapPublish_FileFragment, fileRef)
  const suggestions = useFragment(MapPublish_SuggestionFragment, preview.suggestions)
  const [chosen, setChosen] = useState<string>()

  const fileName = filterColorCodes(file.name)
  // A choice of a suggestion that's no longer offered (after the suggestions were reloaded) is no
  // choice at all
  const chosenValue =
    chosen === NONE_VALUE || suggestions.some(s => s.family.id === chosen) ? chosen : undefined
  const chosenSuggestion = suggestions.find(s => s.family.id === chosenValue)

  const answerFor = (kind: MapPublishAnswerKind, suggestion?: Suggestion): PublishAnswer => ({
    kind,
    family: suggestion ? { id: suggestion.family.id, name: suggestion.family.name } : undefined,
  })
  const button = (key: string, label: string, onClick: () => void, disabled = false) => (
    <TextButton key={key} label={label} disabled={sending || disabled} onClick={onClick} />
  )
  const cancelButton = button('cancel', t('common.actions.cancel', 'Cancel'), onCancel)
  const publishLabel = t('maps.publish.publish', 'Publish')
  const keepButton = button('publish', publishLabel, () =>
    onPublish(answerFor(MapPublishAnswerKind.Keep)),
  )

  let body: React.ReactNode
  let buttons: React.ReactNode[]
  if (preview.blockedReason) {
    body = <BodyText>{blockedReasonText(preview.blockedReason, t)}</BodyText>
    buttons = [button('close', t('common.actions.close', 'Close'), onCancel)]
    if (preview.blockedReason === MapPublishBlockedReason.AlreadyListed) {
      buttons.push(
        button('view', t('maps.catalog.viewMap', 'View map'), () => {
          close()
          push(urlForMapFile(file.family, file.id))
        }),
      )
    }
  } else if (preview.existingMap) {
    const mapName = filterColorCodes(preview.existingMap.name)
    body = (
      <BodyText>
        <Trans t={t} i18nKey='maps.publish.existingMap'>
          This is the same map as <strong>{{ mapName } as TransInterpolation}</strong> and will be
          listed with it.
        </Trans>
      </BodyText>
    )
    buttons = [cancelButton, keepButton]
  } else if (!suggestions.length) {
    body = (
      <BodyText>
        <Trans t={t} i18nKey='maps.publish.ownPage'>
          <strong>{{ fileName } as TransInterpolation}</strong> gets its own page in the catalog.
        </Trans>
      </BodyText>
    )
    buttons = [cancelButton, keepButton]
  } else if (suggestions.length === 1) {
    const suggestion = suggestions[0]
    const mapName = filterColorCodes(suggestion.family.name)
    body = (
      <>
        <BodyText>
          <Trans t={t} i18nKey='maps.publish.oneSuggestion'>
            This looks like a version of <strong>{{ mapName } as TransInterpolation}</strong>. Is
            it?
          </Trans>
        </BodyText>
        <SuggestionPair file={file} suggestion={suggestion} close={close} />
      </>
    )
    buttons = [
      button('unsure', t('maps.publish.notSure', 'Not sure'), () =>
        onPublish(answerFor(MapPublishAnswerKind.Unsure, suggestion)),
      ),
      button('keep', t('maps.publish.separateMap', "No, it's a separate map"), () =>
        onPublish(answerFor(MapPublishAnswerKind.Keep)),
      ),
      button(
        'join',
        [...mapName].length > MAX_JOIN_LABEL_NAME_LENGTH
          ? t('maps.publish.join', 'Yes, add it')
          : t('maps.publish.joinNamed', 'Yes, add it to {{mapName}}', { mapName }),
        () => onPublish(answerFor(MapPublishAnswerKind.Join, suggestion)),
      ),
    ]
  } else {
    body = (
      <>
        <BodyText>
          {t('maps.publish.manySuggestions', 'This looks like a version of one of these maps.')}
        </BodyText>
        <SuggestionList
          suggestions={suggestions}
          fileId={file.id}
          value={chosenValue}
          noneLabel={t('maps.publish.noneOfThese', "None of these, it's a separate map")}
          disabled={sending}
          onChange={setChosen}
          close={close}
        />
      </>
    )
    buttons = [
      cancelButton,
      button('unsure', t('maps.publish.notSure', 'Not sure'), () =>
        // Without a suggestion picked, staff check the likeliest one
        onPublish(answerFor(MapPublishAnswerKind.Unsure, chosenSuggestion ?? suggestions[0])),
      ),
      button(
        'publish',
        publishLabel,
        () =>
          onPublish(
            chosenSuggestion
              ? answerFor(MapPublishAnswerKind.Join, chosenSuggestion)
              : answerFor(MapPublishAnswerKind.Keep),
          ),
        !chosenValue,
      ),
    ]
  }

  return (
    <StyledDialog
      title={t('maps.publish.title', 'Publish map')}
      buttons={buttons}
      onCancel={onCancel}
      showCloseButton={true}>
      <Layout>
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        {body}
        {preview.needsReview && !preview.blockedReason ? (
          <MutedText>
            {t(
              'maps.publish.needsReview',
              "Staff will check this file's name and description before it's listed.",
            )}
          </MutedText>
        ) : null}
      </Layout>
    </StyledDialog>
  )
}

/** The dialog's frame while what it shows is loading, or failed to load. */
function LoadingFrame({
  title,
  failed,
  onRetry,
  onCancel,
}: {
  title: string
  failed: boolean
  onRetry: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <StyledDialog title={title} onCancel={onCancel} showCloseButton={true}>
      {failed ? (
        <LoadErrorRow
          message={t('maps.page.loadError', "Couldn't load this map")}
          onRetry={onRetry}
        />
      ) : (
        <LoadingDotsArea />
      )}
    </StyledDialog>
  )
}

export interface MapPublishDialogProps extends CommonDialogProps {
  fileId: SbMapId
  /** The file the map's page currently shows, if the dialog was opened from a map's page. */
  selectedId?: SbMapId
}

/**
 * Publishes a file: lists it in the catalog, after asking whether it's a version of a map that's
 * already listed when it looks like one.
 */
export function MapPublishDialog({ fileId, selectedId, onCancel, close }: MapPublishDialogProps) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [{ data, error }, refetch] = useQuery({
    query: MapPublishPreviewQuery,
    variables: { fileId },
    requestPolicy: 'network-only',
    context: NO_SUSPENSE_CONTEXT,
  })
  const file = useFragment(MapPublish_FileFragment, data?.map)
  const [{ fetching: sending }, publish] = useMutation(PublishMutation)
  const [errorMessage, setErrorMessage] = useState<string>()

  const title = t('maps.publish.title', 'Publish map')
  const reload = () => refetch({ requestPolicy: 'network-only' })
  if (!data?.mapPublishPreview || !data.map || !file) {
    return (
      <LoadingFrame title={title} failed={!!error || !!data} onRetry={reload} onCancel={onCancel} />
    )
  }

  const onPublish = (answer: PublishAnswer) => {
    setErrorMessage(undefined)
    publish({ fileId, answer: { kind: answer.kind, familyId: answer.family?.id } })
      .then(result => {
        if (result.error || !result.data) {
          setErrorMessage(result.error ? submitErrorText(result.error, t) : genericErrorText(t))
          if (result.error && errorCode(result.error) === 'NOT_SUGGESTED') {
            reload()
          }
          return
        }

        const published = result.data.mapPublish
        const mapName = filterColorCodes(answer.family?.name ?? '')
        let message: string
        if (published.heldForReview) {
          message = t(
            'maps.publish.heldForReview',
            "Sent to staff for review. It's listed once they approve it.",
          )
        } else if (answer.kind === MapPublishAnswerKind.Join) {
          message = t('maps.publish.publishedJoined', 'Published as part of {{mapName}}', {
            mapName,
          })
        } else if (answer.kind === MapPublishAnswerKind.Unsure) {
          message = t(
            'maps.publish.publishedUnsure',
            "Published. Staff will check whether it's a version of {{mapName}}.",
            { mapName },
          )
        } else {
          message = t('maps.publish.published', 'Published')
        }
        close()
        snackbarController.showSnackbar(message)
        // The page showing the file follows it into the map it's in now
        if (selectedId === fileId && published.family.id !== file.family.id) {
          push(urlForMapFile(published.family, fileId))
        }
      })
      .catch(swallowNonBuiltins)
  }

  return (
    <PublishDialogContents
      preview={data.mapPublishPreview}
      file={data.map}
      sending={sending}
      errorMessage={errorMessage}
      onPublish={onPublish}
      onCancel={onCancel}
      close={close}
    />
  )
}

export interface MapFileLinkDialogProps extends CommonDialogProps {
  fileId: SbMapId
  /** The file the map's page currently shows, if the dialog was opened from a map's page. */
  selectedId?: SbMapId
}

/**
 * Adds a file its publisher listed as a map of its own to one of the maps it looks like a version
 * of.
 */
export function MapFileLinkDialog({ fileId, selectedId, onCancel, close }: MapFileLinkDialogProps) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [{ data, error }, refetch] = useQuery({
    query: MapLinkSuggestionsQuery,
    variables: { fileId },
    requestPolicy: 'network-only',
    context: NO_SUSPENSE_CONTEXT,
  })
  const suggestions = useFragment(MapPublish_SuggestionFragment, data?.mapLinkSuggestions)
  const [{ fetching: sending }, link] = useMutation(LinkMutation)
  const [chosen, setChosen] = useState<string>()
  const [errorMessage, setErrorMessage] = useState<string>()

  const title = t('maps.publish.linkTitle', 'Add to another map')
  const reload = () => refetch({ requestPolicy: 'network-only' })
  if (!suggestions || !data?.map) {
    return (
      <LoadingFrame title={title} failed={!!error || !!data} onRetry={reload} onCancel={onCancel} />
    )
  }

  if (!suggestions.length) {
    return (
      <StyledDialog
        title={title}
        buttons={[
          <TextButton key='close' label={t('common.actions.close', 'Close')} onClick={onCancel} />,
        ]}
        onCancel={onCancel}
        showCloseButton={true}>
        <BodyText>
          {t(
            'maps.publish.noLinkSuggestions',
            'No similar maps were found for this file. If it belongs with another map, use ' +
              'Report a problem and staff will take a look.',
          )}
        </BodyText>
      </StyledDialog>
    )
  }

  // A choice of a suggestion that's no longer offered (after the suggestions were reloaded) is no
  // choice at all. A lone suggestion starts out chosen.
  const target =
    suggestions.find(s => s.family.id === chosen) ??
    (chosen === undefined && suggestions.length === 1 ? suggestions[0] : undefined)

  const onLink = () => {
    if (!target) {
      return
    }
    setErrorMessage(undefined)
    link({ fileId, familyId: target.family.id })
      .then(result => {
        if (result.error || !result.data) {
          const code = result.error ? errorCode(result.error) : undefined
          if (code === 'NOT_SUGGESTED') {
            setErrorMessage(
              t('maps.publish.notSuggested', 'That map is no longer suggested for this file.'),
            )
            reload()
          } else if (code === MapPublishBlockedReason.Restricted) {
            setErrorMessage(blockedReasonText(MapPublishBlockedReason.Restricted, t))
          } else {
            setErrorMessage(genericErrorText(t))
          }
          return
        }

        const moved = result.data.mapFileLink
        close()
        snackbarController.showSnackbar(
          t('maps.publish.linked', 'Added to {{mapName}}', {
            mapName: filterColorCodes(target.family.name),
          }),
        )
        if (selectedId === fileId) {
          push(urlForMapFile(moved.family, fileId))
        }
      })
      .catch(swallowNonBuiltins)
  }

  const buttons = [
    <TextButton
      key='cancel'
      label={t('common.actions.cancel', 'Cancel')}
      disabled={sending}
      onClick={onCancel}
    />,
    <TextButton
      key='link'
      label={t('maps.publish.link', 'Add to map')}
      disabled={sending || !target}
      onClick={onLink}
    />,
  ]

  return (
    <StyledDialog title={title} buttons={buttons} onCancel={onCancel} showCloseButton={true}>
      <Layout>
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        <SuggestionList
          suggestions={suggestions}
          fileId={fileId}
          value={target?.family.id}
          disabled={sending}
          onChange={setChosen}
          close={close}
        />
      </Layout>
    </StyledDialog>
  )
}

export interface MapFileUnlinkDialogProps extends CommonDialogProps {
  /** The name of the file to take out of its map. */
  fileName: string
  /** The name of the map it's in. */
  mapName: string
  /** Takes the file out of its map once the user confirms. */
  onConfirm: () => void
}

/** Confirms taking a file its publisher listed out of a map holding other files. */
export function MapFileUnlinkDialog({
  fileName: rawFileName,
  mapName: rawMapName,
  onConfirm,
  onCancel,
  close,
}: MapFileUnlinkDialogProps) {
  const { t } = useTranslation()
  const fileName = filterColorCodes(rawFileName)
  const mapName = filterColorCodes(rawMapName)

  const buttons = [
    <TextButton key='cancel' label={t('common.actions.cancel', 'Cancel')} onClick={onCancel} />,
    <TextButton
      key='confirm'
      label={t('common.actions.remove', 'Remove')}
      onClick={() => {
        close()
        onConfirm()
      }}
    />,
  ]

  return (
    <StyledDialog
      title={t('maps.publish.unlinkTitle', 'Remove from this map')}
      buttons={buttons}
      onCancel={onCancel}>
      <BodyText>
        <Trans t={t} i18nKey='maps.publish.unlinkText'>
          Remove <strong>{{ fileName } as TransInterpolation}</strong> from{' '}
          <strong>{{ mapName } as TransInterpolation}</strong>? It becomes its own map.
        </Trans>
      </BodyText>
    </StyledDialog>
  )
}
