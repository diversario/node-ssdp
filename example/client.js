var ssdp = require('../index').Client
  , client = new ssdp({
//    unicastHost: '192.168.11.63'
  })

client.on('notify', function () {
  //console.log('Got a notification.')
})

client.on('response', function inResponse(headers, code, rinfo) {
  console.log('Got a response to an m-search:\n%d\n%s\n%s', code, JSON.stringify(headers, null, '  '), JSON.stringify(rinfo, null, '  '))
})

client.search('urn:schemas-upnp-org:service:ContentDirectory:1')

// Or maybe if you want to scour for everything after 5 seconds
setTimeout(function() {
  client.search('ssdp:all')
}, 5000)

// And after 10 seconds, you want to stop
setTimeout(function () {
  client.stop()
}, 10000)
