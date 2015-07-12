// Replace one list with the contents of another, preserving any elements in the original list if
// they exist in the new list. Elements in the old list that are not present in the new one will be
// removed, while elements in the new list not in the old one will be inserted. Assumes both lists
// are sorted, and that each list will only contain one item with a particular key
// (calculated/compared by the comparator function).
function replaceInPlace(original, desired, comparator) {
  let o = 0
    , d = 0
  const dLen = desired.length
  for (; d < dLen; d++) {
    if (o >= original.length) break

    let toRemove = 0
      , compared = comparator(original[o], desired[d])
    while (compared < 0 && (o + toRemove) < original.length) {
      toRemove++
      if ((o + toRemove < original.length)) {
        compared = comparator(original[o + toRemove], desired[d])
      }
    }


    if (compared === 0) {
      // we've hit an element to keep
      if (toRemove > 0) {
        original.splice(o, toRemove)
      }

      o++
      continue
    } else if ((o + toRemove) >= original.length) {
      // the rest of the elements should be removed and then the complex logic in this loop is done
      original.splice(o, toRemove)
      break
    }

    // there is/are element(s) to add
    const newElems = []
    while (d < dLen && compared > 0) {
      newElems.push(desired[d])
      d++
      if (d < dLen) compared = comparator(original[o + toRemove], desired[d])
    }
    if (d < dLen && compared !== 0) {
      // this element is not actually in the array either, so we can remove it in the same chunk
      d--
      toRemove++
    }
    const numNew = newElems.length
      , args = newElems
    args.unshift(o, toRemove)
    original.splice.apply(original, args)

    o += numNew
    if (d < dLen && compared === 0) o++ // we already know this element is in the list
  }

  if (o < original.length) {
    original.splice(o, original.length - o)
  }
  while (d < dLen) {
    original.push(desired[d++])
  }
}

function sortedInsert(list, value, comparator) {
  for (let i = 0, len = list.length; i < len; i++) {
    if (comparator(value, list[i]) < 0) {
      list.splice(i, 0, value)
      return i
    }
  }

  list.push(value)
  return list.length - 1
}

export default {
  replaceInPlace,
  sortedInsert,
}
