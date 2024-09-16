import React, { useState } from 'react'
import styled from 'styled-components'
import { useImmer } from 'use-immer'
import { getErrorStack } from '../../common/errors'
import { useSelfPermissions } from '../auth/auth-utils'
import { useForm } from '../forms/form-hook'
import { MaterialIcon } from '../icons/material/material-icon'
import { getExtension } from '../maps/upload'
import { RaisedButton, TextButton } from '../material/button'
import { MultiFileInput } from '../material/file-input'
import { fetchJson } from '../network/fetch'
import LoadingIndicator from '../progress/dots'
import { useStableCallback } from '../state-hooks'
import {
  amberA400,
  background600,
  colorError,
  colorSuccess,
  colorTextSecondary,
} from '../styles/colors'
import { SubheadingOld, singleLine, subtitle1 } from '../styles/typography'

export function AdminMapManager() {
  const permissions = useSelfPermissions()

  return (
    <Container>
      {permissions?.manageMaps && <UploadMaps />}
      {permissions?.massDeleteMaps && <MassDeleteMaps />}
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
  const [nameToUploadStatus, setNameToUploadStatus] = useImmer<Map<File, UploadStatus>>(new Map())

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
    <>
      <Underline>Select maps to upload</Underline>

      <form noValidate={true} onSubmit={onSubmit}>
        <MultiFileInput {...bindCustom('maps')} inputProps={{ accept: '.scm,.scx' }} />
      </form>

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

      {maps.length > 0 ? (
        <RaisedButton label='Upload' disabled={disableUploadButton} onClick={() => onSubmit()} />
      ) : null}
    </>
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
    <>
      <Underline>Delete all maps</Underline>

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

      {isDeleting ? <LoadingIndicator /> : null}

      {deleteError ? <ErrorText>Something went wrong: {deleteError.message}</ErrorText> : null}
    </>
  )
}

const Container = styled.div`
  max-width: 600px;
  padding: 0 16px;
  overflow-y: auto;
`

const SelectedFiles = styled.ul`
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

const Underline = styled.div`
  ${subtitle1};
  color: ${colorTextSecondary};
`

const ErrorText = styled(SubheadingOld)`
  color: ${colorError};
`

const WarningText = styled(SubheadingOld)`
  color: ${amberA400};
`
