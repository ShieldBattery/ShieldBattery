import { graphql } from '../gql'

/**
 * Files a report against a player from a game. Kept out of the report dialog's module so it can be
 * used without loading the dialog.
 */
export const ReportGameMutation = graphql(/* GraphQL */ `
  mutation ReportGame($input: ReportGameInput!) {
    reportGame(input: $input) {
      id
    }
  }
`)
