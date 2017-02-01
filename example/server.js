var SSDP = require('../index').Server
  , server = new SSDP({
    //unicastHost: '192.168.11.63',
    location: require('ip').address() + '/desc.html',
    customHeaders: {
      "fieldName1.domain.com": "fieldValue1",
      "fieldName2.domain.com": "fieldValue2"
    }
  })

server.addUSN('upnp:rootdevice')
server.addUSN('urn:schemas-upnp-org:device:MediaServer:1')
server.addUSN('urn:schemas-upnp-org:service:ContentDirectory:1')
server.addUSN('urn:schemas-upnp-org:service:ConnectionManager:1')

server.on('advertise-alive', function (heads) {
  //console.log('advertise-alive', heads)
  // Expire old devices from your cache.
  // Register advertising device somewhere (as designated in http headers heads)
})

server.on('advertise-bye', function (heads) {
  //console.log('advertise-bye', heads)
  // Remove specified device from cache.
})

// start server on all interfaces
server.start()
