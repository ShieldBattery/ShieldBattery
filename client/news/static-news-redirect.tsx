import { Redirect } from 'wouter'
import { urlForNewsPost } from './news-url'

// Number of seeded historical news posts (see migrations/20260711120000_seed_news_posts.sql). Each
// old /static-news/:index maps to the fixed UUID 5eed0000-...-0000000000(index+1).
const SEED_COUNT = 23

function seedUuid(index: number): string {
  return `5eed0000-0000-0000-0000-0000000000${String(index + 1).padStart(2, '0')}`
}

/**
 * Redirects the old /static-news/:index URLs to their seeded /news/:prettyId/_ permalinks (the
 * post page swaps in the title slug once the post has loaded).
 */
export function StaticNewsRedirect({ params }: { params: { id: string } }) {
  const index = Number(params.id)
  if (Number.isInteger(index) && index >= 0 && index < SEED_COUNT) {
    return <Redirect to={urlForNewsPost(seedUuid(index))} replace={true} />
  }
  return <Redirect to='/' replace={true} />
}
