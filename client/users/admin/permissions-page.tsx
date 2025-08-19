import { useState } from 'react'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import { SbUser } from '../../../common/users/sb-user'
import { useSelfPermissions, useSelfUser } from '../../auth/auth-utils'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import { graphql, useFragment } from '../../gql'
import { AdminUserProfile_PermissionsFragment } from '../../gql/graphql'
import { logger } from '../../logging/logger'
import { TextButton } from '../../material/button'
import { CheckBox } from '../../material/check-box'
import { LoadingDotsArea } from '../../progress/dots'
import { TitleLarge, bodyLarge } from '../../styles/typography'

const AdminSection = styled.div`
  block-size: min-content;
  padding: 16px 16px 0;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const LoadingError = styled.div`
  ${bodyLarge};
  width: 100%;
  margin-top: 40px;
  margin-bottom: 48px;
`

const PermissionsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  max-width: 600px;
  gap: 8px 16px;
  margin: 16px 0;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`

const AdminUserProfileQuery = graphql(/* GraphQL */ `
  query AdminUserProfile($userId: SbUserId!, $includePermissions: Boolean!) {
    user(id: $userId) {
      id
      ...AdminUserProfile_Permissions @include(if: $includePermissions)
    }
  }
`)

const PermissionsFragment = graphql(/* GraphQL */ `
  fragment AdminUserProfile_Permissions on SbUser {
    id
    permissions {
      id
      editPermissions
      debug
      banUsers
      manageLeagues
      manageMaps
      manageMapPools
      manageMatchmakingTimes
      manageMatchmakingSeasons
      manageRallyPointServers
      massDeleteMaps
      moderateChatChannels
      manageNews
      manageBugReports
      manageRestrictedNames
      manageSignupCodes
    }
  }
`)

const UpdatePermissionsMutation = graphql(/* GraphQL */ `
  mutation AdminUpdateUserPermissions($userId: SbUserId!, $permissions: SbPermissionsInput!) {
    userUpdatePermissions(userId: $userId, permissions: $permissions) {
      ...AdminUserProfile_Permissions
    }
  }
`)

export interface AdminPermissionsPageProps {
  user: SbUser
}

export function AdminPermissionsPage({ user }: AdminPermissionsPageProps) {
  const selfUser = useSelfUser()!
  const selfPermissions = useSelfPermissions()

  const [{ data }] = useQuery({
    query: AdminUserProfileQuery,
    variables: {
      userId: user.id,
      includePermissions: !!selfPermissions?.editPermissions,
    },
  })
  const userPermissionsFragment = useFragment(PermissionsFragment, data?.user)

  if (!selfPermissions?.editPermissions) {
    return <LoadingError>Access denied.</LoadingError>
  }

  if (!userPermissionsFragment) {
    return <LoadingDotsArea />
  }

  return (
    <AdminSection>
      <TitleLarge>Permissions</TitleLarge>
      <PermissionsEditor fragment={userPermissionsFragment} isSelf={selfUser.id === user.id} />
    </AdminSection>
  )
}

function PermissionsEditor({
  fragment,
  isSelf,
}: {
  fragment: AdminUserProfile_PermissionsFragment
  isSelf: boolean
}) {
  const { id: userId, permissions } = fragment
  const [{ fetching }, updatePermissions] = useMutation(UpdatePermissionsMutation)
  const [errorMessage, setErrorMessage] = useState<string>()

  const { submit, bindCheckable, form } = useForm(permissions, {})

  useFormCallbacks(form, {
    onSubmit: model => {
      updatePermissions({ userId, permissions: model })
        .then(result => {
          if (result.error) {
            setErrorMessage(result.error.message)
          } else {
            setErrorMessage(undefined)
          }
        })
        .catch(err => logger.error(`Error changing permissions: ${err.stack ?? err}`))
    },
  })

  const inputProps = {
    tabIndex: 0,
  }

  return (
    <>
      {errorMessage ? <LoadingError>{errorMessage}</LoadingError> : null}
      <form noValidate={true} onSubmit={submit} data-test='permissions-form'>
        <PermissionsGrid>
          <CheckBox
            {...bindCheckable('editPermissions')}
            label='Edit permissions'
            inputProps={inputProps}
            disabled={isSelf || fetching}
          />
          <CheckBox
            {...bindCheckable('debug')}
            label='Debug'
            inputProps={inputProps}
            disabled={fetching}
          />
          <CheckBox
            {...bindCheckable('banUsers')}
            label='Ban users'
            inputProps={inputProps}
            disabled={fetching}
          />
          <CheckBox
            {...bindCheckable('manageLeagues')}
            label='Manage leagues'
            inputProps={inputProps}
            disabled={fetching}
          />
          <CheckBox
            {...bindCheckable('manageMaps')}
            label='Manage maps'
            inputProps={inputProps}
            disabled={fetching}
          />
          <CheckBox
            {...bindCheckable('manageMapPools')}
            label='Manage matchmaking map pools'
            inputProps={inputProps}
            disabled={fetching}
          />
          <CheckBox
            {...bindCheckable('manageMatchmakingTimes')}
            label='Manage matchmaking times'
            inputProps={inputProps}
            disabled={fetching}
          />
          <CheckBox
            {...bindCheckable('manageMatchmakingSeasons')}
            label='Manage matchmaking seasons'
            inputProps={inputProps}
            disabled={fetching}
          />
          <CheckBox
            {...bindCheckable('manageRallyPointServers')}
            label='Manage rally-point servers'
            inputProps={inputProps}
            disabled={fetching}
          />
          <CheckBox
            {...bindCheckable('massDeleteMaps')}
            label='Mass delete maps'
            inputProps={inputProps}
            disabled={fetching}
          />
          <CheckBox
            {...bindCheckable('moderateChatChannels')}
            label='Moderate chat channels'
            inputProps={inputProps}
            disabled={fetching}
          />
          <CheckBox
            {...bindCheckable('manageNews')}
            label='Manage news'
            inputProps={inputProps}
            disabled={fetching}
          />
          <CheckBox
            {...bindCheckable('manageBugReports')}
            label='Manage bug reports'
            inputProps={inputProps}
            disabled={fetching}
          />
          <CheckBox
            {...bindCheckable('manageRestrictedNames')}
            label='Manage restricted names'
            inputProps={inputProps}
            disabled={fetching}
          />
          <CheckBox
            {...bindCheckable('manageSignupCodes')}
            label='Manage signup codes'
            inputProps={inputProps}
            disabled={fetching}
          />
        </PermissionsGrid>

        <TextButton
          label='Save'
          tabIndex={0}
          onClick={submit}
          disabled={fetching}
          testName='save-permissions-button'
        />
      </form>
    </>
  )
}
