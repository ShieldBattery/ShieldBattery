import React, { useState } from 'react'
import styled from 'styled-components'
import { getErrorStack } from '../../common/errors'
import { useSelfPermissions } from '../auth/auth-utils'
import { useForm } from '../forms/form-hook'
import { MaterialIcon } from '../icons/material/material-icon'
import { getExtension } from '../maps/upload'
import { RaisedButton, TextButton } from '../material/button'
import { MultiFileInput } from '../material/file-input'
import { fetchJson } from '../network/fetch'
import LoadingIndicator from '../progress/dots'
import { useImmerState, useStableCallback } from '../state-hooks'
import {
  amberA400,
  background600,
  colorError,
  colorSuccess,
  colorTextSecondary,
} from '../styles/colors'
import { bodyLarge, labelMedium, singleLine, titleLarge } from '../styles/typography'

export function AdminMapManager() {
  const permissions = useSelfPermissions()

  return (
    <Container>
      <HeadlineContainer>
        <PageHeadline>Manage maps</PageHeadline>
      </HeadlineContainer>

      <Content>
        {permissions?.manageMaps && <UploadMaps />}
        {permissions?.massDeleteMaps && <MassDeleteMaps />}
      </Content>
    </Container>
  )
}

enum UploadStatus {
  Pending = 0,
  Uploading,
  Success,
  Error,
}

interface UploadMapsModel {
  maps: File[]
}

function UploadMaps() {
  const [nameToUploadStatus, setNameToUploadStatus] = useImmerState<Map<File, UploadStatus>>(
    new Map(),
  )

  const onFormSubmit = useStableCallback((model: Readonly<UploadMapsModel>) => {
    setNameToUploadStatus(new Map(model.maps.map(m => [m, UploadStatus.Uploading])))

    for (const map of model.maps) {
      const formData = new FormData()
      formData.append('extension', getExtension(map.name))
      formData.append('file', map)

      const fetchParams = {
        method: 'post',
        body: formData,
      }

      fetchJson('/api/1/maps/official', fetchParams)
        .then(() => {
          setNameToUploadStatus(draft => {
            draft.set(map, UploadStatus.Success)
          })
        })
        .catch(err => {
          console.log(getErrorStack(err))
          setNameToUploadStatus(draft => {
            draft.set(map, UploadStatus.Error)
          })
        })
    }
  })

  const onFormChange = useStableCallback((model: Readonly<UploadMapsModel>) => {
    setNameToUploadStatus(new Map(model.maps.map(m => [m, UploadStatus.Pending])))
  })

  const { bindCustom, getInputValue, onSubmit } = useForm(
    {
      maps: [],
    },
    {},
    { onSubmit: onFormSubmit, onChange: onFormChange },
  )

  const maps = getInputValue('maps')

  const disableUploadButton = Array.from(nameToUploadStatus.values()).some(
    u => u !== UploadStatus.Pending,
  )
  return (
    <SectionContainer>
      <SectionTitle>Select maps to upload</SectionTitle>

      <form noValidate={true} onSubmit={onSubmit}>
        <MultiFileInput {...bindCustom('maps')} inputProps={{ accept: '.scm,.scx' }} />
      </form>

      {maps.length > 0 && (
        <SelectedFiles>
          {maps.map(map => {
            const uploadStatus = nameToUploadStatus.get(map)!

            return (
              <SelectedFileEntry key={map.name}>
                <FileName>{map.name}</FileName>

                {uploadStatus !== UploadStatus.Pending ? (
                  <UploadStatusIndicator status={uploadStatus} />
                ) : null}
              </SelectedFileEntry>
            )
          })}
        </SelectedFiles>
      )}

      {maps.length > 0 ? (
        <RaisedButton label='Upload' disabled={disableUploadButton} onClick={() => onSubmit()} />
      ) : null}
    </SectionContainer>
  )
}

function UploadStatusIndicator({ status }: { status: UploadStatus }) {
  let statusElem: React.ReactNode
  switch (status) {
    case UploadStatus.Uploading:
      statusElem = <LoadingIndicator />
      break
    case UploadStatus.Success:
      statusElem = <StyledSuccessIcon />
      break
    case UploadStatus.Error:
      statusElem = <StyledErrorIcon />
      break
    default:
      statusElem = null
  }

  return <StatusContainer>{statusElem}</StatusContainer>
}

function MassDeleteMaps() {
  const [areYouSure, setAreYouSure] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<Error>()

  const onDeleteMapsClick = () => {
    setAreYouSure(false)
    setIsDeleting(true)
    setDeleteError(undefined)

    fetchJson('/api/1/maps/', { method: 'DELETE' })
      .then(() => {
        setIsDeleting(false)
      })
      .catch(err => {
        setIsDeleting(false)
        setDeleteError(err)
      })
  }

  return (
    <SectionContainer>
      <SectionTitle>Delete all maps</SectionTitle>

      <RaisedButton
        label='Delete all maps'
        disabled={isDeleting}
        onClick={() => setAreYouSure(true)}
      />

      {areYouSure ? (
        <div>
          <WarningText>
            WARNING! This action will delete all maps in the database and their respective files.
            This cannot be reversed.
          </WarningText>

          <p>Are you sure?</p>
          <TextButton label='No' color='accent' onClick={() => setAreYouSure(false)} />
          <TextButton label='Yes' color='accent' onClick={onDeleteMapsClick} />
        </div>
      ) : null}

      {isDeleting ? <StyledLoadingIndicator /> : null}

      {deleteError ? <ErrorText>Something went wrong: {deleteError.message}</ErrorText> : null}
    </SectionContainer>
  )
}

const Container = styled.div`
  max-width: 960px;
  margin: 0 16px;
  overflow-y: auto;
`

const HeadlineContainer = styled.div`
  height: 48px;
  display: flex;
  align-items: center;
  margin-top: 8px;
  margin-bottom: 8px;
`

const PageHeadline = styled.div`
  ${titleLarge};
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 24px;
`

const SectionContainer = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
`

const SelectedFiles = styled.ul`
  width: 100%;
  margin: 8px 0;
  padding: 8px 0;
  background-color: ${background600};
  border-radius: 8px;
`

const SelectedFileEntry = styled.li`
  ${singleLine};

  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  height: 48px;
  font-size: 16px;
  padding: 0 16px;
`

const FileName = styled.span`
  ${singleLine};
`

const StatusContainer = styled.div`
  margin-left: 16px;
`

const StyledSuccessIcon = styled(MaterialIcon).attrs({ icon: 'check_circle' })`
  color: ${colorSuccess};
`

const StyledErrorIcon = styled(MaterialIcon).attrs({ icon: 'error' })`
  color: ${colorError};
`

const SectionTitle = styled.div`
  ${labelMedium};
  color: ${colorTextSecondary};

  padding: 4px 0;
`

const StyledLoadingIndicator = styled(LoadingIndicator)`
  margin: 8px 0;
`

const ErrorText = styled.div`
  ${bodyLarge}
  color: ${colorError};
`

const WarningText = styled.p`
  ${bodyLarge}
  color: ${amberA400};
`
