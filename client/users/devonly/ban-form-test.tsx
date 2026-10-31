import styled from 'styled-components'
import { PunishmentDuration } from '../admin/punishment-durations'
import { BanUserForm } from '../admin/punishments-page'

const Container = styled.div`
  max-width: 720px;
  padding: 16px;
`

export function BanFormTest() {
  return (
    <Container>
      <BanUserForm
        model={{
          duration: PunishmentDuration.OneDay,
          endTime: '',
          reason: '',
          refundGames: true,
        }}
        canRefundGames={true}
        onSubmit={() => {}}
      />
    </Container>
  )
}
