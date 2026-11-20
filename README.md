[![Build Status](https://github.com/diversario/node-ssdp/actions/workflows/test.yml/badge.svg?branch=master)](https://github.com/diversario/node-ssdp/actions/workflows/test.yml)
[![Coverage Status](https://coveralls.io/repos/github/diversario/node-ssdp/badge.svg?branch=master)](https://coveralls.io/github/diversario/node-ssdp?branch=master)
[![NPM version](https://badge.fury.io/js/node-ssdp.svg)](http://badge.fury.io/js/node-ssdp)

## Installation

```sh
npm install node-ssdp
```

Requires Node.js 22.12 or newer.

There is another package called `ssdp` which is the original unmaintained version. Make sure to install `node-ssdp` instead.

## Upgrading from version 4

Version 5 needs Node.js 22.12 or newer.

Check these points in your code and on your network:

- **`server.stop()` finishes later.** It sends `ssdp:byebye`, then closes the sockets. In version 4 the sockets were closed when `stop()` returned, and `ssdp:byebye` did not go out. `stop()` now returns a promise and takes an optional callback. Wait for it before you call `start()` again or end the process.

  ```javascript
  server.stop().then(function () {
    process.exit()
  })
  ```

- **`start()` can fail.** When a socket cannot be bound, `start()` rejects its promise and calls its callback with the error. In version 4 it never finished. It also fails when `stop()` is called before the start is done. Handle the error.

- **A client uses UDP port 1900.** It listens there for NOTIFY messages and emits `advertise-alive` and `advertise-bye`. In version 4 a client with default options never got these events. A client cannot start when another program holds port 1900 and does not allow address reuse.

- **A server sends `ssdp:alive` and `ssdp:byebye` from a port that the system picks.** In version 4 they came from port 1900. Answers to searches still come from port 1900. Pass `sourcePort: 1900` to send them from port 1900 again.

- **A server waits before it answers a search.** The wait is a random time between 0 and the `MX` value of the search, in seconds. A value above 5 counts as 5. UPnP recommends this, so that many devices do not answer at the same moment. In version 4 the server answered at once. The client of this library sends `MX: 3`, so wait at least 3 seconds for the answers. Pass `mxDelay: false` to the server to answer at once.

- **Several network interfaces work without extra options.**
  - Messages to the SSDP group go out through every interface. In version 4 the system picked one interface for all of them.
  - A server no longer sends duplicate answers for the same USN. A search gets one answer for each USN that matches. In version 4 a server with two interfaces sent four answers for one USN.
  - With the `location` option as an object, LOCATION has the address of the interface that is on the subnet of the client.
  - `explicitSocketBind` is not needed for this anymore.

- **`sockets` holds sending sockets only.** The sockets in `server.sockets` and `client.sockets` send to the SSDP group and receive answers to searches. M-SEARCH and NOTIFY arrive on a separate socket.

- **An interface that cannot join the multicast group is skipped.** The library prints a warning that names the interface. The code of the warning is `NODE_SSDP_INTERFACE_SKIPPED`. That interface sends but does not receive. `start()` fails only when no interface can join. In version 4 the process stopped with an uncaught error.

- **Linux lets one socket join a multicast group on 20 interfaces by default.** Interfaces past that limit are skipped as described above. On a machine with more network interfaces, name the ones to use in the `interfaces` option. The limit is the `net.ipv4.igmp_max_memberships` setting.

- **A warning tells when messages cannot leave through an interface.** When a search or an advertisement cannot be sent to the SSDP group through an interface, the library prints a warning that names the interface. The code of the warning is `NODE_SSDP_SEND_FAILED`. Devices on that network do not get the messages. In version 4 the error was only in the debug log. On macOS this happens when the program is not allowed to use the local network: see System Settings, Privacy & Security, Local Network.

- **The `ip` module is not installed with this package anymore.** Add it to your own dependencies if your code uses it.

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
- `mxDelay` _Boolean_ Wait a random time before answering an `M-SEARCH`, as UPnP recommends. The time is between 0 and the `MX` value of the search, in seconds, and 5 seconds at most. Default: `true`
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
npm run test:local  # network tests on this machine, no container
npm run lint        # ESLint, finds mistakes in the code
```

The network tests send real SSDP packets over multicast. They run in a container and build a small virtual network in it: several machines on one lan, and a machine with two network interfaces between two lans. They show how the library behaves on Linux only.

- `DEBUG='node-ssdp:*' make test-network` prints the library logs of every machine.
- `sh test/network/run.sh --grep byebye` passes arguments to mocha.

`test/network/support/lab.js` describes how the virtual network is built.

The local network tests also send real SSDP packets. They run servers and clients as separate processes on the machine itself, through its own network interfaces. CI runs them on Linux, macOS and Windows. They need one network interface that can send multicast, and one IPv4 address on every interface. On macOS, the program that starts them needs the Local Network permission.

# License

(The MIT License)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
