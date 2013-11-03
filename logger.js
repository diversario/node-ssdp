var bunyan = require('bunyan');
var PrettyStream = require('bunyan-prettystream');

process.stdout.setMaxListeners(100)

module.exports = function(config) {
  if (!config) config = {}
  
  var loggerConfig = {
    name: 'ssdp',
    streams: [],
    src: true
  }
  
  if (config.log === true) {
    var prettyStdOut = new PrettyStream()
    prettyStdOut.pipe(process.stdout)
    
    loggerConfig.streams.push({
      level: 'error',
      type: 'raw',
      stream: prettyStdOut
    })
  }
  
  var logger = bunyan.createLogger(loggerConfig)

  config.logLevel && logger.level(config.logLevel)

  return logger
}
