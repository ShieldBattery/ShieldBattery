// Used to decorate command handler classes by adding all aliases of a particular command as a
// method to their handler class
export function Aliases(command) {
  return function(target) {
    command.aliases.forEach((alias, index, array) => {
      target.prototype[alias] = target.prototype[array[0]]
    })
  }
}
