let id = 0

/**
 * Returns an ID that is unique for each call, intended to be used for UI elements that need to be
 * referenced from elsewhere (e.g. form inputs that need to be referenced by a label element).
 *
 * @deprecated Move to a function component and use React's `useId` instead
 */
export default function genId(): string {
  return 'sb_id_' + id++
}
