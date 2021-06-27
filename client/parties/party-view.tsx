import React, { useEffect } from 'react'
import { push } from '../navigation/routing'
import { useAppSelector } from '../redux-hooks'
import { usePrevious } from '../state-hooks'

interface PartyViewProps {
  params: { partyId: string }
}

export function PartyView(props: PartyViewProps) {
  const partyId = decodeURIComponent(props.params.partyId).toLowerCase()
  const prevPartyId = usePrevious(partyId)
  const isInParty = useAppSelector(s => !!s.party.id)
  const prevIsInParty = usePrevious(isInParty)
  const isLeavingParty = prevIsInParty && !isInParty && prevPartyId === partyId

  // TODO(2Pac): Pull this out into some kind of "isLeaving" hook and share with chat/whispers/lobby
  useEffect(() => {
    if (isLeavingParty) {
      push('/')
    }
  }, [isLeavingParty])

  return <span>Party view</span>
}
