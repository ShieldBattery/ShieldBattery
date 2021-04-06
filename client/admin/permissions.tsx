import React, { useCallback, useEffect, useRef } from 'react'
import styled from 'styled-components'
import { Permissions } from '../../common/users/permissions'
import form, { FormChildProps, FormWrapper } from '../forms/form'
import CheckBox from '../material/check-box'
import FlatButton from '../material/flat-button'
import LoadingIndicator from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { getPermissionsIfNeeded, setPermissions } from './action-creators'

const Container = styled.div``

interface ExtraFormProps {
  isSelf: boolean
}

class UserPermissionsForm extends React.Component<FormChildProps<Permissions> & ExtraFormProps> {
  render() {
    const { isSelf, onSubmit, bindCheckable } = this.props
    const inputProps = {
      tabIndex: 0,
    }
    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <CheckBox
          {...bindCheckable('editPermissions')}
          label='Edit permissions'
          inputProps={inputProps}
          disabled={isSelf}
        />
        <CheckBox {...bindCheckable('debug')} label='Debug' inputProps={inputProps} />
        <CheckBox
          {...bindCheckable('acceptInvites')}
          label='Accept beta invites'
          inputProps={inputProps}
        />
        <CheckBox
          {...bindCheckable('editAllChannels')}
          label='Edit all channels'
          inputProps={inputProps}
        />
        <CheckBox {...bindCheckable('banUsers')} label='Ban users' inputProps={inputProps} />
        <CheckBox {...bindCheckable('manageMaps')} label='Manage maps' inputProps={inputProps} />
        <CheckBox
          {...bindCheckable('manageMapPools')}
          label='Manage matchmaking map pools'
          inputProps={inputProps}
        />
        <CheckBox
          {...bindCheckable('manageMatchmakingTimes')}
          label='Manage matchmaking times'
          inputProps={inputProps}
        />
        <CheckBox
          {...bindCheckable('manageRallyPointServers')}
          label='Manage rally-point servers'
          inputProps={inputProps}
        />
        <CheckBox
          {...bindCheckable('massDeleteMaps')}
          label='Mass delete maps'
          inputProps={inputProps}
        />
      </form>
    )
  }
}

const WrappedUserPermissionsForm = form<Permissions, ExtraFormProps>()(UserPermissionsForm)

export interface PermissionsResultProps {
  username: string
}

export default function PermissionsResult({ username }: PermissionsResultProps) {
  const dispatch = useAppDispatch()
  const selfName = useAppSelector(s => s.auth.user.name)
  const permissionsByUser = useAppSelector(s => s.permissions.users)
  const formRef = useRef<typeof WrappedUserPermissionsForm>(null)

  const onSubmit = useCallback(
    (form: FormWrapper<Permissions>) => {
      const values = form.getModel()
      dispatch(setPermissions(username, values))
    },
    [username, dispatch],
  )
  const onSaveClick = useCallback(() => {
    formRef.current?.submit()
  }, [])

  useEffect(() => {
    dispatch(getPermissionsIfNeeded(username))
  }, [username])

  const user = permissionsByUser.get(username)

  if (!user || user.isRequesting) {
    return <LoadingIndicator />
  }

  if (user.lastError) {
    return <p>{user.lastError.message}</p>
  }

  const model = user.toObject()

  return (
    <Container>
      <h3>Set permissions for {username}</h3>
      <WrappedUserPermissionsForm
        ref={formRef as any}
        isSelf={username === selfName}
        model={model}
        onSubmit={onSubmit}
      />
      <FlatButton label='Save' color='accent' tabIndex={0} onClick={onSaveClick} />
    </Container>
  )
}
