module.exports = function() {
  function link(scope, elem, attrs, ctrl) {
    var locked = true
      , domElem = elem[0]
      , triggeredScroll = false

    elem.bind('scroll', function() {
      if (!triggeredScroll) {
        scope.$apply(function() { locked = isAtBottom(domElem) })
      }
    })

    scope.$watch(function() {
      if (locked) {
        triggeredScroll = true
        doScroll(domElem)
        triggeredScroll = false
      }
    })
  }

  function doScroll(domElem) {
    domElem.scrollTop = domElem.scrollHeight
  }

  function isAtBottom(domElem) {
    return (domElem.scrollTop + domElem.clientHeight) === domElem.scrollHeight
  }

  return  { priority: 1
          , restrict: 'A'
          , link: link
          }
}
