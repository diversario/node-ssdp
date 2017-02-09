# SSDP fork for React Native from node

This is a fork of `node-ssdp` that uses `react-native-udp` instead of `dgram` to enable react multicast messaging and plain socket control. The API is the same as in the forked version. Make sure you properly install and link [react-native-udp](https://github.com/tradle/react-native-udp) and set the `Buffer` variable as global or install the browser-compatible npm buffer package.

Make sure you close all the sockets you open and never try to reopen one already open, mobile OSs and React Native are very aggresive both with security and performance, so a misuse could kill your process.

<a href="https://getyeti.co" target="_blank">
   <img alt="works with yeti" src="https://github.com/netbeast/react-native-dial/raw/master/works-with-yeti.png" width="100" />
</a>

> This package powers [Yeti Smart Home](https://getyeti.co) and is used in production. It is maintained with our developers's free time, PRs and issues are more than welcome.

## Installation

```bash
yarn buffer react-native-udp react-native-ssdp
rnmp link # or follow manual linking instructions from react-native-udp
```



## Usage - Client

```javascript
    var Client = require('react-native-ssdp').Client
      , client = new Client();

    client.on('response', function (headers, statusCode, rinfo) {
      console.log('Got a response to an m-search.');
    });

    // search for a service type
    client.search('urn:schemas-upnp-org:service:ContentDirectory:1');

    // Or get a list of all services on the network

    client.search('ssdp:all');
```

## Usage - Server

```javascript
    var Server = require('react-native-ssdp').Server
      , server = new Server()
    ;

    server.addUSN('upnp:rootdevice');
    server.addUSN('urn:schemas-upnp-org:device:MediaServer:1');
    server.addUSN('urn:schemas-upnp-org:service:ContentDirectory:1');
    server.addUSN('urn:schemas-upnp-org:service:ConnectionManager:1');

    server.on('advertise-alive', function (headers) {
      // Expire old devices from your cache.
      // Register advertising device somewhere (as designated in http headers heads)
    });

    server.on('advertise-bye', function (headers) {
      // Remove specified device from cache.
    });

    // start the server
    server.start();

    process.on('exit', function(){
      server.stop() // advertise shutting down and stop listening
    })
```


# Legacy docs from the forked repo

Take a look at `example` directory as well to see examples or client and server.

##Configuration
`new SSDP([options, [socket]])`

SSDP constructor accepts an optional configuration object and an optional initialized socket. At the moment, the following is supported:

- `ssdpSig` _String_ SSDP signature. Default: `node.js/NODE_VERSION UPnP/1.1 node-ssdp/PACKAGE_VERSION`
- `ssdpIp` _String_ SSDP multicast group. Default: `239.255.255.250`.
- `ssdpPort` _Number_ SSDP port. Default: `1900`
- `ssdpTtl` _Number_ Multicast TTL. Default: `1`
- `adInterval` _Number_ `advertise` event frequency (ms). Default: 10 sec.
- `unicastHost` _String_ IP address or hostname of server where SSDP service is running. This is used in `HOST` header. Default: `0.0.0.0`.
- `location` _String_ URL pointing to description of your service, or a function which returns that URL
- `udn` _String_ Unique Device Name. Default: `uuid:f40c2981-7329-40b7-8b04-27f187aecfb5`.
- `description` _String_ Path to description file. Default: `upnp/desc.php`.
- `ttl` _Number_ Packet TTL. Default: `1800`.
- `allowWildcards` _Boolean_ Accept wildcards (`*`) in `serviceTypes` of `M-SEARCH` packets, e.g. `usn:Belkin:device:**`. Default: `false`

###Logging

You can enable logging via an environment variable `DEBUG`. Set `DEBUG=node-ssdp*` to enable all logs. To enable only client or server logs, use
`DEBUG=node-ssdp:client` or `DEBUG=node-ssdp:server` respectively.

# License

(The MIT License)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
