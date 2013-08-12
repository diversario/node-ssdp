var bunyan = require('bunyan');
var PrettyStream = require('bunyan-prettystream');

process.stdout.setMaxListeners(100)

module.exports = function(config) {
  if (!config) config = {}
  
  var prettyStdOut = new PrettyStream()
  prettyStdOut.pipe(process.stdout)

  var logger = bunyan.createLogger({
    name: 'ssdp',
    streams: [{
      level: 'error',
      type: 'raw',
      stream: prettyStdOut
    }]
  })

  config.logLevel && logger.level(config.logLevel)

  // don't log when running tests
  if (process.env.NODE_ENV == 'test') logger.level('FATAL')

  return logger
}
