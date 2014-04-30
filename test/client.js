var ssdp = require('../')
  , client = new ssdp({logLevel: 'TRACE', log: true});

client.on('response', function inResponse(msg, rinfo) {
  //console.log('Got a response to an m-search:', msg.toString());
});

client.search('urn:schemas-upnp-org:service:ContentDirectory:1');

// Or maybe if you want to scour for everything

client.search('ssdp:all');