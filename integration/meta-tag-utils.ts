/**
 * Extracts the `content` attribute of the first `<meta>` tag matching the given `property`/`name`
 * attribute, regardless of attribute order or quote style.
 */
export function extractMetaContent(
  html: string,
  attr: 'property' | 'name',
  key: string,
): string | undefined {
  const tag = html.match(new RegExp(`<meta[^>]*${attr}=["']${key}["'][^>]*>`, 'i'))?.[0]
  return tag?.match(/content=["']([^"']*)["']/i)?.[1]
}
