/**
 * Takes an iterator that is usually returned by `String.matchAll()` method and replaces all matches
 * in a given text by calling the replacement function. This function is mostly useful when you need
 * to replace the matches with something that's not a string, e.g. a HTML element or a React
 * component. If you just need to replace all the matches with a string, using `String.replaceAll()`
 * might be more straightforward.
 *
 * @returns An array of replaced elements combined with text that was not replaced. In case the
 *   replaced element was a string, you can just use the `Array.join('')` method to get the complete
 *   text.
 */
export function replaceMatchesInText(
  matches: IterableIterator<RegExpMatchArray> | RegExpMatchArray[],
  text: string,
  replaceFunc: (match: RegExpMatchArray) => unknown,
): unknown[] {
  const elements = []
  let lastIndex = 0

  for (const match of matches) {
    // Insert preceding text, if any
    if (match.index! > lastIndex) {
      elements.push(text.substring(lastIndex, match.index))
    }

    elements.push(replaceFunc(match))

    lastIndex = match.index! + match[0].length
  }

  // Insert remaining text, if any
  if (text.length > lastIndex) {
    elements.push(text.substring(lastIndex))
  }

  return elements
}
