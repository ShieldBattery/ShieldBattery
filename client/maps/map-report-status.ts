import { useMutation } from 'urql'
import { graphql } from '../gql'
import { MapFamilyReportStatus } from '../gql/graphql'
import { useSnackbarController } from '../snackbars/snackbar-overlay'

// Only staff handle map reports, so what's here isn't translated.

/** Selects what a report's views show about its status, so they update from the result. */
const SetReportStatusMutation = graphql(/* GraphQL */ `
  mutation MapFamilyReportSetStatus($id: UUID!, $status: MapFamilyReportStatus!) {
    mapFamilyReportSetStatus(id: $id, status: $status) {
      id
      status
      resolvedAt
      resolvedBy {
        id
      }
    }
  }
`)

/** What setting a report's status does to it, for confirming the change. */
const STATUS_DONE_TEXT: Record<MapFamilyReportStatus, string> = {
  [MapFamilyReportStatus.Open]: 'reopened',
  [MapFamilyReportStatus.Resolved]: 'resolved',
  [MapFamilyReportStatus.Dismissed]: 'dismissed',
}

/** Returns a function that sets a report's status, rejecting with the reason if that failed. */
export function useSetReportStatus() {
  const [, setStatus] = useMutation(SetReportStatusMutation)
  return async (id: string, status: MapFamilyReportStatus): Promise<void> => {
    const result = await setStatus({ id, status })
    if (result.error) {
      throw new Error(result.error.graphQLErrors[0]?.message ?? result.error.message)
    }
  }
}

/** Like {@link useSetReportStatus}, but tells the user how it went with a snackbar. */
export function useChangeReportStatus() {
  const snackbarController = useSnackbarController()
  const setStatus = useSetReportStatus()
  return (id: string, status: MapFamilyReportStatus) => {
    setStatus(id, status)
      .then(() => snackbarController.showSnackbar(`Report ${STATUS_DONE_TEXT[status]}`))
      .catch((err: Error) =>
        snackbarController.showSnackbar(`Couldn't update the report: ${err.message}`),
      )
  }
}
