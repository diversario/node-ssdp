## Usage - Client

```javascript
    var ssdp = require('../')
      , client = new ssdp();
    
    client.on('notify', function () {
      console.log('Got a notification.');
    });
    
    client.on('response', function inResponse(msg, rinfo) {
      console.log('Got a response to an m-search.');
    });
    
    client.search('urn:schemas-upnp-org:service:ContentDirectory:1');
    
    // Or maybe if you want to scour for everything
    
    client.search('ssdp:all');
    
    // This should get you at least started.
```

## Usage - Server

```javascript
    var SSDP = require('../')
      , server = new SSDP()
    ;
    
    server.addUSN('upnp:rootdevice');
    server.addUSN('urn:schemas-upnp-org:device:MediaServer:1');
    server.addUSN('urn:schemas-upnp-org:service:ContentDirectory:1');
    server.addUSN('urn:schemas-upnp-org:service:ConnectionManager:1');
    
    server.on('advertise-alive', function (heads) {
      // Expire old devices from your cache.
      // Register advertising device somewhere (as designated in http headers heads)
    });
    
    server.on('advertise-bye', function (heads) {
      // Remove specified device from cache.
    });
    
    // This should get your local ip to pass off to the server.
    require('dns').lookup(require('os').hostname(), function (err, add) {
      server.server(add);
    });
```

##Configuration
SSDP constructor accepts an optional configuration object. At the moment, the following is supported:

- `log` _Boolean_ Enable/disable logging. Default: false.
- `logLevel` _String_ Specifies log level to print. Possible values: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. Defaults to `ERROR`.
- `ssdpSig` _String_ SSDP signature. Default: 'node.js/0.0.8 UPnP/1.1 node-ssdp/0.1.1'
- `ssdpIp` _String_ SSDP multicast group. Default: '239.255.255.250'
- `ssdpPort` _Number_ SSDP port. Default: 1900
- `ssdpTtl` _Number_ Multicast TTL. Default: 1
- `udn` _String_ Unique Device Name. Defaults to "uuid:e3f28962-f694-471f-8f74-c6abd507594b".
- `description` _String_ Path to description file. Defaults to "upnp/desc.php".
- `ttl` _Number_ Packet TTL. Default: 1800.

## Author

Initial commit of this module is a clone of https://bitbucket.org/Xedecimal/node-ssdp, commit 0c6cd0a (2012-03-21).

Forked with author's permission.

# License

(The MIT License)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

