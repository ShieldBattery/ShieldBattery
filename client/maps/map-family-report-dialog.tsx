import { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CombinedError, useMutation, useQuery } from 'urql'
import { filterColorCodes, SbMapId } from '../../common/maps'
import { useSelfUser } from '../auth/auth-utils'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { graphql } from '../gql'
import { MapFamilyReportKind } from '../gql/graphql'
import { dateTimeFormat, useFormat } from '../i18n/locale-formats'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { RadioButton, RadioGroup } from '../material/radio'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { TextField } from '../material/text-field'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium } from '../styles/typography'
import { duplicateFileNames } from './map-family-files'
import { MapFamilyCandidate, MapFamilySearch } from './map-family-search'
import { MapReportOption, mapReportOptions, pickOrOnlyChoice, ReportFileTarget } from './map-owner'

/** Keep in sync with `MAX_REPORT_NOTE_LENGTH` on the server (maps/families/edit.rs). */
const MAX_NOTE_LENGTH = 500

const ReportFamilyQuery = graphql(/* GraphQL */ `
  query MapFamilyReportFamily($id: UUID!) {
    mapFamily(id: $id) {
      id
      family {
        id
        current {
          id
        }
        owner {
          id
          name
        }
        files {
          id
          name
          listed
          firstSeenAt
        }
      }
    }
  }
`)

const ReportMutation = graphql(/* GraphQL */ `
  mutation MapFamilyReport($input: MapFamilyReportInput!) {
    mapFamilyReport(input: $input) {
      id
      status
    }
  }
`)

function errorMessage(error: CombinedError, t: TFunction): string {
  switch (error.graphQLErrors[0]?.extensions?.code) {
    case 'RATE_LIMITED':
      return t(
        'maps.report.rateLimited',
        "You've sent too many reports recently. Please try again later.",
      )
    case 'RESTRICTED':
      return t('maps.report.restricted', 'You are currently restricted from reporting.')
    default:
      return t('maps.report.error', 'Something went wrong. Please try again later.')
  }
}

function noteTooLong(note: string): boolean {
  // Counts code points (not UTF-16 units) to match the server's chars().count()
  return [...note].length > MAX_NOTE_LENGTH
}

const StyledDialog = styled(Dialog)`
  max-width: 560px;
`

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Intro = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

export interface MapFamilyReportDialogProps extends CommonDialogProps {
  familyId: string
  fileId: SbMapId
  /** How many of the map's files the reporter can see. */
  fileCount: number
}

/**
 * Requests results without suspending: the dialog shows its other options while the map's details
 * load. Module-level so the query sees the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const uploadedFormat = dateTimeFormat({ year: 'numeric', month: 'short', day: 'numeric' })

/** The file a report option is about, picked from `target`'s choices unless it's fixed. */
function targetFile(
  target: ReportFileTarget | undefined,
  picked: SbMapId | undefined,
): SbMapId | undefined {
  if (!target) {
    return undefined
  }
  if ('fixed' in target) {
    return target.fixed
  }
  return pickOrOnlyChoice(target.choices, picked)
}

/**
 * Tells staff something about the file being viewed or its map: that the file isn't part of the
 * map, that the map is the same as another map, that another file should be its recommended one,
 * that its maker didn't make it, or that a file is inappropriate. Nothing changes until staff look
 * at it.
 */
export function MapFamilyReportDialog({
  familyId,
  fileId,
  fileCount,
  onCancel,
  close,
}: MapFamilyReportDialogProps) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const selfUser = useSelfUser()
  const uploadedDate = useFormat(uploadedFormat)
  const [chosenKind, setChosenKind] = useState<MapReportOption>()
  const [picked, setPicked] = useState<MapFamilyCandidate>()
  const [pickedFiles, setPickedFiles] = useState<
    Partial<Record<'wrongDefault' | 'inappropriate', SbMapId>>
  >({})
  const [note, setNote] = useState('')
  const [submitError, setSubmitError] = useState<string>()
  const [{ fetching: sending }, report] = useMutation(ReportMutation)
  const [{ data: familyData }] = useQuery({
    query: ReportFamilyQuery,
    variables: { id: familyId },
    context: NO_SUSPENSE_CONTEXT,
  })

  const family = familyData?.mapFamily?.family
  const { options, wrongDefault, inappropriate } = mapReportOptions({
    fileCount,
    family: family
      ? {
          ownerId: family.owner?.id,
          currentId: family.current.id,
          files: family.files,
        }
      : undefined,
    viewerId: selfUser?.id,
    contextFileId: fileId,
  })
  const kind = options.length === 1 ? options[0] : options.find(o => o === chosenKind)
  const wrongDefaultFile = targetFile(wrongDefault, pickedFiles.wrongDefault)
  const inappropriateFile = targetFile(inappropriate, pickedFiles.inappropriate)

  const ownerName = family?.owner?.name ?? ''
  const labels: Record<MapReportOption, string> = {
    wrongMap: t('maps.report.wrongMapOption', "This file doesn't belong in this map"),
    sameMap: t('maps.report.sameMapOption', 'This map is the same as another map'),
    wrongDefault:
      wrongDefault && 'choices' in wrongDefault
        ? t('maps.report.wrongDefaultOtherOption', 'Another file should be the recommended one')
        : t('maps.report.wrongDefaultOption', 'This file should be the recommended one'),
    wrongOwner: t('maps.report.wrongOwnerOption', "{{ownerName}} didn't make this map", {
      ownerName,
    }),
    inappropriate: t(
      'maps.report.inappropriateOption',
      'Inappropriate name, description or content',
    ),
  }

  const canSubmit =
    (kind === 'sameMap' && !!picked) ||
    kind === 'wrongMap' ||
    kind === 'wrongOwner' ||
    (kind === 'wrongDefault' && !!wrongDefaultFile) ||
    (kind === 'inappropriate' && !!inappropriateFile)

  const inputFor = (reportKind: MapReportOption, trimmedNote: string | undefined) => {
    switch (reportKind) {
      case 'wrongMap':
        return { kind: MapFamilyReportKind.WrongMap, mapId: fileId, note: trimmedNote }
      case 'sameMap':
        return {
          kind: MapFamilyReportKind.SameMap,
          familyId,
          otherFamilyId: picked!.familyId,
          note: trimmedNote,
        }
      case 'wrongDefault':
        return {
          kind: MapFamilyReportKind.WrongDefault,
          mapId: wrongDefaultFile,
          familyId,
          note: trimmedNote,
        }
      case 'wrongOwner':
        return { kind: MapFamilyReportKind.WrongOwner, familyId, note: trimmedNote }
      case 'inappropriate':
        return {
          kind: MapFamilyReportKind.Inappropriate,
          mapId: inappropriateFile,
          familyId,
          note: trimmedNote,
        }
      default:
        return reportKind satisfies never
    }
  }

  /** A select of the files a report option can be about, when it isn't about the viewed file. */
  const fileSelect = (option: 'wrongDefault' | 'inappropriate', target?: ReportFileTarget) => {
    if (!target || 'fixed' in target || !family) {
      return null
    }
    const names = target.choices.map(id => family.files.find(f => f.id === id)!)
    const duplicates = duplicateFileNames(names)
    return (
      <Select
        label={t('maps.report.whichFile', 'Which file?')}
        value={targetFile(target, pickedFiles[option])}
        dense={true}
        allowErrors={false}
        disabled={sending}
        onChange={(value: SbMapId) => setPickedFiles(prev => ({ ...prev, [option]: value }))}>
        {names.map(file => {
          const name = filterColorCodes(file.name)
          return (
            <SelectOption
              key={file.id}
              value={file.id}
              text={
                duplicates.has(name)
                  ? `${name} (${uploadedDate.format(new Date(file.firstSeenAt))})`
                  : name
              }
            />
          )
        })}
      </Select>
    )
  }

  const onSubmit = () => {
    if (!kind || !canSubmit) {
      return
    }
    setSubmitError(undefined)
    report({
      input: inputFor(kind, note.trim() || undefined),
    })
      .then(result => {
        if (result.error) {
          setSubmitError(errorMessage(result.error, t))
          return
        }
        snackbarController.showSnackbar(t('maps.report.sent', 'Thanks! Staff will take a look.'))
        close()
      })
      .catch(() =>
        setSubmitError(t('maps.report.error', 'Something went wrong. Please try again later.')),
      )
  }

  const buttons = [
    <TextButton
      key='cancel'
      label={t('common.actions.cancel', 'Cancel')}
      disabled={sending}
      onClick={onCancel}
    />,
    <TextButton
      key='submit'
      label={t('maps.report.send', 'Send to staff')}
      disabled={sending || noteTooLong(note) || !kind || !canSubmit}
      onClick={onSubmit}
    />,
  ]

  return (
    <StyledDialog
      title={t('maps.report.title', 'Report a problem')}
      buttons={buttons}
      onCancel={onCancel}
      showCloseButton={true}>
      <Layout>
        {submitError ? <ErrorText>{submitError}</ErrorText> : null}
        {options.length > 1 ? (
          <RadioGroup
            value={kind}
            dense={true}
            onChange={e => setChosenKind(e.target.value as MapReportOption)}>
            {options.map(option => (
              <RadioButton key={option} value={option} label={labels[option]} disabled={sending} />
            ))}
          </RadioGroup>
        ) : (
          <Intro>{labels[options[0]]}</Intro>
        )}
        {kind === 'wrongDefault' ? fileSelect('wrongDefault', wrongDefault) : null}
        {kind === 'inappropriate' ? fileSelect('inappropriate', inappropriate) : null}
        {kind === 'sameMap' ? (
          <MapFamilySearch
            picked={picked}
            onPick={setPicked}
            excludeFamilyId={familyId}
            disabled={sending}
          />
        ) : null}
        <TextField
          label={t('maps.report.note', 'Anything staff should know? (optional)')}
          multiline={true}
          rows={2}
          maxRows={6}
          value={note}
          disabled={sending}
          errorText={
            noteTooLong(note)
              ? t('maps.report.noteTooLong', {
                  defaultValue: 'Keep it under {{max}} characters.',
                  max: MAX_NOTE_LENGTH,
                })
              : undefined
          }
          onChange={e => setNote(e.target.value)}
        />
      </Layout>
    </StyledDialog>
  )
}
