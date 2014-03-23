#!/usr/bin/env node

var buf = Buffer('')
  , idgen = require('../')
  , cmd = require('commander')

cmd
  .version(require('../package.json').version)
  .description(require('../package.json').description)
  .option('-e, --encoding <encoding>', 'specify encoding for STDIN')
  .option('-n, --noline', 'no line feed after output')
  .parse(process.argv)

process.stdin.on('readable', function () {
  var chunk = process.stdin.read();
  if (chunk !== null) {
    buf = Buffer.concat([buf, cmd.encoding ? Buffer(String(chunk), cmd.encoding) : chunk]);
  }
  else {
    process.stdin.pause();
    var len = cmd.args[0] ? parseInt(cmd.args[0], 10) : null;
    buf = buf.length ? buf : null;
    process.stdout.write(idgen(len, buf));
    if (!cmd.noline) process.stdout.write('\n');
    process.exit();
  }
});
