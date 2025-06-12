import { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'
import {
  AddRallyPointServerRequest,
  AddRallyPointServerResponse,
  GetRallyPointServersResponse,
  RallyPointServer,
  UpdateRallyPointServerRequest,
  UpdateRallyPointServerResponse,
} from '../../common/rally-point'
import { apiUrl } from '../../common/urls'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton, IconButton, TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { NumberTextField } from '../material/number-text-field'
import { TextField } from '../material/text-field'
import { fetchJson } from '../network/fetch'
import { useRefreshToken } from '../network/refresh-token'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../styles/centered-container'
import { bodyLarge, titleLarge } from '../styles/typography'

const Content = styled.div`
  max-width: 960px;
  margin: 0 auto;
`

const PageHeadline = styled.div`
  ${titleLarge};
  margin-top: 16px;
  margin-bottom: 8px;
`

const HeadlineAndButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  margin-bottom: 8px;
  padding-left: 12px;
`

const Row = styled.div<{ $editable?: boolean }>`
  ${bodyLarge};
  min-height: 48px;
  display: flex;
  align-items: center;

  padding-left: ${props => (props.$editable ? '0' : '12px')};
  padding-right: ${props => (props.$editable ? '0' : '172px')};
`

const EnabledContent = styled.div<{ $editable?: boolean }>`
  width: 24px;
  height: 24px;
  margin-right: 16px;
  flex-grow: 0;

  margin-bottom: ${props => (props.$editable ? '20px' : '0')};
`

const DescriptionContent = styled.div`
  flex-basis: 128px;
  flex-grow: 1;
`

const HostnameContent = styled.div`
  margin: 0 8px;

  flex-basis: 128px;
  flex-grow: 1;
`

const PortContent = styled.div`
  width: 104px;
  flex-grow: 0;
`

const ButtonWithIcon = styled(TextButton)`
  padding-left: 12px;

  svg {
    margin-right: 8px;
  }
`

const ButtonRow = styled.div`
  display: flex;
  margin-bottom: 20px;
`

interface AddServerModel {
  description?: string
  hostname?: string
  port: number
}

export function AddServerRow(props: {
  onSubmit: (model: AddServerModel) => void
  onCancel: () => void
}) {
  const {
    submit: onSubmit,
    bindInput,
    bindCustom,
    form,
  } = useForm<AddServerModel>(
    { port: 14098 },
    {
      description: value => (value && value.length ? undefined : 'Description must be provided'),
      hostname: value => (value && value.length ? undefined : 'Hostname must be provided'),
      port: value =>
        value <= 0 || value >= 65536 ? 'Enter a value between 1 and 65535' : undefined,
    },
  )

  useFormCallbacks(form, {
    onSubmit: props.onSubmit,
  })

  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />
      <Row $editable={true}>
        <EnabledContent $editable={true} />
        <DescriptionContent>
          <TextField
            {...bindInput('description')}
            label='Description'
            floatingLabel={true}
            dense={true}
            inputProps={{
              tabIndex: 0,
            }}
          />
        </DescriptionContent>
        <HostnameContent>
          <TextField
            {...bindInput('hostname')}
            label='Hostname'
            floatingLabel={true}
            dense={true}
            inputProps={{
              tabIndex: 0,
            }}
          />
        </HostnameContent>
        <PortContent>
          <NumberTextField
            {...bindCustom('port')}
            floatingLabel={false}
            dense={true}
            label='Port'
            inputProps={{ min: 1, max: 65536 }}
          />
        </PortContent>
        <ButtonRow>
          <ButtonWithIcon
            label={
              <>
                <MaterialIcon icon='close' />
                <span>Cancel</span>
              </>
            }
            onClick={props.onCancel}
          />
          <ButtonWithIcon
            label={
              <>
                <MaterialIcon icon='check' />
                <span>Save</span>
              </>
            }
            onClick={onSubmit}
          />
        </ButtonRow>
      </Row>
    </form>
  )
}

export function ServerRow({
  server,
  onEdit,
}: {
  server: RallyPointServer
  onEdit: (server: RallyPointServer) => void
}) {
  const onClick = useCallback(() => {
    onEdit(server)
  }, [onEdit, server])

  return (
    <Row>
      <EnabledContent>
        {server.enabled ? <MaterialIcon icon='check' /> : <MaterialIcon icon='close' />}
      </EnabledContent>
      <DescriptionContent>{server.description}</DescriptionContent>
      <HostnameContent>{server.hostname}</HostnameContent>
      <PortContent>{server.port}</PortContent>
      <IconButton icon={<MaterialIcon icon='edit' />} title='Edit' onClick={onClick} />
    </Row>
  )
}

type EditServerModel = Omit<RallyPointServer, 'id'>

export function EditServerRow({
  server,
  onSubmit: onFormSubmit,
  onCancel,
}: {
  server: RallyPointServer
  onSubmit: (server: RallyPointServer) => void
  onCancel: () => void
}) {
  // Keep a reference to the first server passed in just to ensure we know its ID even if the prop
  // changes?
  const [serverState] = useState(server)

  if (serverState.id !== server.id) {
    // TODO(tec27): It'd be better to be able to reset the form when this happens, need to
    // impelment that though. In any case I don't think that can happen with this form because of
    // keys in its parent
    throw new Error('server prop changed :(')
  }

  const onSubmitCallback = useCallback(
    (model: EditServerModel) => {
      onFormSubmit({
        ...model,
        id: serverState.id,
      })
    },
    [onFormSubmit, serverState.id],
  )

  const {
    submit: onSubmit,
    bindCheckable,
    bindInput,
    bindCustom,
    form,
  } = useForm<EditServerModel>(
    {
      enabled: server.enabled,
      description: server.description,
      hostname: server.hostname,
      port: server.port,
    },
    {
      description: value => (value && value.length ? undefined : 'Description must be provided'),
      hostname: value => (value && value.length ? undefined : 'Hostname must be provided'),
      port: value =>
        value <= 0 || value >= 65536 ? 'Enter a value between 1 and 65535' : undefined,
    },
  )

  useFormCallbacks(form, {
    onSubmit: onSubmitCallback,
  })

  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />
      <Row $editable={true}>
        <EnabledContent $editable={true}>
          <CheckBox {...bindCheckable('enabled')} inputProps={{ tabIndex: 0, title: 'Enabled' }} />
        </EnabledContent>
        <DescriptionContent>
          <TextField
            {...bindInput('description')}
            label='Description'
            floatingLabel={true}
            dense={true}
            inputProps={{
              tabIndex: 0,
            }}
          />
        </DescriptionContent>
        <HostnameContent>
          <TextField
            {...bindInput('hostname')}
            label='Hostname'
            floatingLabel={true}
            dense={true}
            inputProps={{
              tabIndex: 0,
            }}
          />
        </HostnameContent>
        <PortContent>
          <NumberTextField
            {...bindCustom('port')}
            floatingLabel={true}
            dense={true}
            label='Port'
            inputProps={{ min: 1, max: 65536 }}
          />
        </PortContent>
        <ButtonRow>
          <ButtonWithIcon
            iconStart={<MaterialIcon icon='close' />}
            label='Cancel'
            onClick={onCancel}
          />
          <ButtonWithIcon
            iconStart={<MaterialIcon icon='check' />}
            label='Save'
            onClick={onSubmit}
          />
        </ButtonRow>
      </Row>
    </form>
  )
}

export function AdminRallyPoint() {
  const [refreshToken, triggerRefresh] = useRefreshToken()
  const [servers, setServers] = useState<RallyPointServer[]>([])
  const [isAdding, setIsAdding] = useState(false)
  const [editing, setEditing] = useState<number>()
  const snackbarController = useSnackbarController()

  const onAddClick = useCallback(() => {
    setIsAdding(true)
  }, [])
  const onAddSubmit = useCallback(
    (model: AddServerModel) => {
      const requestBody: AddRallyPointServerRequest = {
        description: model.description!,
        hostname: model.hostname!,
        port: model.port,
      }
      fetchJson<AddRallyPointServerResponse>(apiUrl`admin/rally-point/`, {
        method: 'post',
        body: JSON.stringify(requestBody),
      })
        .then(() => {
          setIsAdding(false)
          triggerRefresh()
        })
        .catch(err => {
          snackbarController.showSnackbar('Error adding server')
          console.error(err)
        })
    },
    [snackbarController, triggerRefresh],
  )
  const onAddCancel = useCallback(() => {
    setIsAdding(false)
  }, [])

  const onEdit = useCallback((server: RallyPointServer) => {
    setEditing(server.id)
  }, [])
  const onEditSubmit = useCallback(
    (server: RallyPointServer) => {
      const requestBody: UpdateRallyPointServerRequest = {
        id: server.id,
        enabled: server.enabled,
        description: server.description,
        hostname: server.hostname,
        port: server.port,
      }
      fetchJson<UpdateRallyPointServerResponse>(apiUrl`admin/rally-point/${server.id}`, {
        method: 'put',
        body: JSON.stringify(requestBody),
      })
        .then(() => {
          setEditing(undefined)
          triggerRefresh()
        })
        .catch(err => {
          snackbarController.showSnackbar('Error editing server')
          console.error(err)
        })
    },
    [snackbarController, triggerRefresh],
  )
  const onEditCancel = useCallback(() => {
    setEditing(undefined)
  }, [])

  useEffect(() => {
    fetchJson<GetRallyPointServersResponse>(apiUrl`admin/rally-point/`)
      .then(data => setServers(data.servers))
      .catch(err => {
        snackbarController.showSnackbar('Error retrieving servers')
        console.error(err)
      })
  }, [refreshToken, snackbarController])

  return (
    <CenteredContentContainer>
      <Content>
        <HeadlineAndButton>
          <PageHeadline>Rally-point servers</PageHeadline>
          <FilledButton label='Refresh' onClick={triggerRefresh} />
        </HeadlineAndButton>
        {servers.map(s =>
          editing === s.id ? (
            <EditServerRow key={s.id} server={s} onSubmit={onEditSubmit} onCancel={onEditCancel} />
          ) : (
            <ServerRow key={s.id} server={s} onEdit={onEdit} />
          ),
        )}
        {isAdding ? (
          <AddServerRow onSubmit={onAddSubmit} onCancel={onAddCancel} />
        ) : (
          <FilledButton label={'Add'} onClick={onAddClick} />
        )}
      </Content>
    </CenteredContentContainer>
  )
}
