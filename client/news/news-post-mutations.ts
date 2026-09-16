import { graphql } from '../gql'

export const NewsUpdatePostMutation = graphql(/* GraphQL */ `
  mutation NewsUpdatePost($id: UUID!, $updates: NewsPostUpdates!) {
    newsUpdatePost(id: $id, updates: $updates) {
      id
      title
      summary
      content
      publishedAt
      updatedAt
      coverImagePath
      coverImageUrl
      coverImageSmallUrl
    }
  }
`)

export const NewsDeletePostMutation = graphql(/* GraphQL */ `
  mutation NewsDeletePost($id: UUID!) {
    newsDeletePost(id: $id)
  }
`)
