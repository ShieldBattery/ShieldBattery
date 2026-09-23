export type PostStatus =
  | { kind: 'draft' }
  | { kind: 'scheduled'; date: Date }
  | { kind: 'published'; date: Date }

/** Classifies a post's publish state given the current time (`now`, in millis). */
export function getPostStatus(publishedAt: string | null | undefined, now: number): PostStatus {
  if (!publishedAt) {
    return { kind: 'draft' }
  }
  const date = new Date(publishedAt)
  return date.getTime() > now ? { kind: 'scheduled', date } : { kind: 'published', date }
}
