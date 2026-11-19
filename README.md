[![Build Status](https://github.com/diversario/node-ssdp/actions/workflows/test.yml/badge.svg?branch=master)](https://github.com/diversario/node-ssdp/actions/workflows/test.yml)
[![Coverage Status](https://img.shields.io/coveralls/diversario/node-ssdp.svg)](https://coveralls.io/r/diversario/node-ssdp?branch=master)
[![Dependency Status](https://gemnasium.com/diversario/node-ssdp.png)](https://gemnasium.com/diversario/node-ssdp)
[![NPM version](https://badge.fury.io/js/node-ssdp.svg)](http://badge.fury.io/js/node-ssdp)

## Installation

```sh
npm install node-ssdp
```

Requires Node.js 22.12 or newer.

There is another package called `ssdp` which is the original unmaintained version. Make sure to install `node-ssdp` instead.

## Usage - Client

```javascript
    var Client = require('node-ssdp').Client
      , client = new Client();

    client.on('response', function (headers, statusCode, rinfo) {
      console.log('Got a response to an m-search.');
    });

    // devices also say when they join and leave the network
    client.on('advertise-alive', function (headers, rinfo) {});
    client.on('advertise-bye', function (headers, rinfo) {});

    // search for a service type
    client.search('urn:schemas-upnp-org:service:ContentDirectory:1');

    // Or get a list of all services on the network

    client.search('ssdp:all');
```

## Usage - Server

```javascript
    var Server = require('node-ssdp').Server
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

    // advertise shutting down, then stop listening
    process.on('SIGINT', function () {
      server.stop().then(function () {
        process.exit()
      })
    })
```

Take a look at `example` directory as well to see examples or client and server.

## Configuration

### Client

```
const Client = require('node-ssdp').Client
const client = new Client({...})
```

- `interfaces` _String[]_ List of interfaces to explicitly bind. By default, bind to all available interfaces.
- `explicitSocketBind` _Boolean_ Bind the sending socket of each interface to the address of that interface. By default it is bound to all addresses.
- `customLogger` _Function_ A logger function to use instead of the default. The first argument to the function can contain a format string.
- `reuseAddr` _Boolean_ When true `socket.bind()` will reuse the address, even if another process has already bound a socket on it. Default: `true`

### Server

```
const Server = require('node-ssdp').Server
const server = new Server({...})
```

- `location` _String_ URL pointing to description of your service, or a function which returns that URL
- `location` _Object_ For cases where there are multiple network interfaces or IP of the host isn't known in advance, it's possible to specify location as an object. Host will be set to the IP of the responding interface.
  - `location.protocol` _String_ Location protocol, defaults to `http://`
  - `location.port` _Number_ Location port. No default.
  - `location.path` _String_ Location path. No default.
- `udn` _String_ Unique Device Name. Default: `uuid:f40c2981-7329-40b7-8b04-27f187aecfb5`.
- `allowWildcards` _Boolean_ Accept wildcards (`*`) in `serviceTypes` of `M-SEARCH` packets, e.g. `usn:Belkin:device:**`. Default: `false`
- `interfaces` _String[]_ List of interfaces to explicitly bind. By default, bind to all available interfaces.
- `explicitSocketBind` _Boolean_ Bind the sending socket of each interface to the address of that interface. By default it is bound to all addresses.
- `customLogger` _Function_ A logger function to use instead of the default. The first argument to the function can contain a format string.
- `suppressRootDeviceAdvertisements` _Boolean_ When true the SSDP server will not advertise the root device (i.e. the bare UDN). In some scenarios this advertisement is not needed. Default: `false`
- `reuseAddr` _Boolean_ When true `socket.bind()` will reuse the address, even if another process has already bound a socket on it. Default: `true`
- `adInterval` _Number_ `advertise` event frequency (ms). Default: 10 sec.
- `ttl` _Number_ Packet TTL. Default: `1800`.

### SSDP configuration:
- `ssdpSig` _String_ SSDP signature. Default: `node.js/NODE_VERSION UPnP/1.1 node-ssdp/PACKAGE_VERSION`
- `ssdpIp` _String_ SSDP multicast group. Default: `239.255.255.250`.
- `ssdpPort` _Number_ SSDP port. Default: `1900`
- `ssdpTtl` _Number_ Multicast TTL. Default: `4`


### Logging

You can enable logging via an environment variable `DEBUG`. Set `DEBUG=node-ssdp:*` to enable all logs. To enable only client or server logs, use
`DEBUG=node-ssdp:client` or `DEBUG=node-ssdp:server` respectively.

Alternatively, you can provide your own `customLogger` function, in which case the `DEBUG` environment variable will be ignored.

## Testing

```sh
npm test            # unit tests, the network is faked
npm run coverage    # unit tests with a coverage report
make test-network   # network tests, needs podman or docker
```

The network tests send real SSDP packets over multicast. They run in a container and build a small virtual network in it: several machines on one lan, and a machine with two network interfaces between two lans. They show how the library behaves on Linux only.

- `DEBUG='node-ssdp:*' make test-network` prints the library logs of every machine.
- `sh test/network/run.sh --grep byebye` passes arguments to mocha.

`test/network/support/lab.js` describes how the virtual network is built.

# License

(The MIT License)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

[![Analytics](https://ga-beacon.appspot.com/UA-51511945-1/node-ssdp/README.md)](https://github.com/igrigorik/ga-beacon)
