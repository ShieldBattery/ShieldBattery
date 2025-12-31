import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { SbUser } from '../../../common/users/sb-user'
import { UserIpInfoJson } from '../../../common/users/user-network'
import { LoadingDotsArea } from '../../progress/dots'
import { useAppDispatch } from '../../redux-hooks'
import { TitleLarge, bodyLarge, bodyMedium } from '../../styles/typography'
import { adminGetUserIps } from '../action-creators'
import { ConnectedUsername } from '../connected-username'

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

const IpListRoot = styled.div`
  ${bodyLarge};
  padding: 16px 0;
  display: flex;
  flex-direction: column;
  gap: 32px;

  user-select: contain;

  & * {
    user-select: text;
  }
`

const IpEntry = styled.div``

const IpAddress = styled.div`
  /* No blur filter since users explicitly navigated to this page */
`

const IpDateRange = styled.div`
  color: var(--theme-on-surface-variant);
`

const SeenCount = styled.div`
  color: var(--theme-on-surface-variant);
`

const RelatedUsers = styled.div`
  ${bodyMedium};
  margin: 16px 0;
  padding-left: 40px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const dateRangeFormat = new Intl.DateTimeFormat(navigator.language, {
  dateStyle: 'short',
  timeStyle: 'short',
})

export interface AdminIpAddressesPageProps {
  user: SbUser
}

export function AdminIpAddressesPage({ user }: AdminIpAddressesPageProps) {
  const dispatch = useAppDispatch()
  const [ips, setIps] = useState<ReadonlyDeep<UserIpInfoJson[]>>()
  const [relatedUsers, setRelatedUsers] = useState<ReadonlyDeep<Map<string, UserIpInfoJson[]>>>()

  const [requestError, setRequestError] = useState<Error>()
  const cancelLoadRef = useRef(new AbortController())

  const userId = user.id

  useEffect(() => {
    cancelLoadRef.current.abort()
    const abortController = new AbortController()
    cancelLoadRef.current = abortController

    dispatch(
      adminGetUserIps(userId, {
        signal: abortController.signal,
        onStart: () => {
          setIps(undefined)
          setRequestError(undefined)
        },
        onSuccess: response => {
          setIps(response.ips)
          setRelatedUsers(new Map(response.relatedUsers))
        },
        onError: err => setRequestError(err),
      }),
    )

    return () => {
      abortController.abort()
    }
  }, [userId, dispatch])

  return (
    <AdminSection>
      <TitleLarge>IP addresses</TitleLarge>
      {requestError ? <LoadingError>{requestError.message}</LoadingError> : null}
      {ips === undefined ? <LoadingDotsArea /> : <IpList ips={ips} relatedUsers={relatedUsers!} />}
    </AdminSection>
  )
}

function IpList({
  ips,
  relatedUsers,
}: {
  ips: ReadonlyDeep<UserIpInfoJson[]>
  relatedUsers: ReadonlyDeep<Map<string, UserIpInfoJson[]>>
}) {
  return (
    <IpListRoot>
      {ips.map(info => {
        const related = relatedUsers.get(info.ipAddress) || []
        return (
          <IpEntry key={info.ipAddress}>
            <IpAddress>{info.ipAddress}</IpAddress>
            <IpDateRange>
              {dateRangeFormat.format(info.firstUsed)} &ndash;{' '}
              {dateRangeFormat.format(info.lastUsed)}
            </IpDateRange>
            <SeenCount>Seen {info.timesSeen} times</SeenCount>
            <RelatedUsers>
              {related.map(r => (
                <IpEntry key={r.userId}>
                  <ConnectedUsername userId={r.userId} />
                  <IpDateRange>
                    {dateRangeFormat.format(r.firstUsed)} &ndash;{' '}
                    {dateRangeFormat.format(r.lastUsed)}
                  </IpDateRange>
                  <SeenCount>Seen {r.timesSeen} times</SeenCount>
                </IpEntry>
              ))}
            </RelatedUsers>
          </IpEntry>
        )
      })}
    </IpListRoot>
  )
}
