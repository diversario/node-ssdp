'use strict'

// Runs inside one host of the virtual network (see `lab.js`). It owns one
// SSDP server, one SSDP client or one probe.
//
// The test process sends commands over the IPC channel. This process answers
// every command, and reports every SSDP event or packet it sees.

const dgram = require('node:dgram')
const os = require('node:os')
const ssdp = require('../../..')

const SSDP_GROUP = '239.255.255.250'
const SSDP_PORT = 1900

let node

function report (event) {
  process.send({ event })
}

function createSsdp (kind, opts, usns) {
  const instance = kind === 'server' ? new ssdp.Server(opts) : new ssdp.Client(opts)

  usns.forEach((usn) => instance.addUSN(usn))

  instance.on('response', (headers, statusCode, rinfo) => {
    report({ name: 'response', headers, statusCode, rinfo })
  })

  instance.on('advertise-alive', (headers, rinfo) => {
    report({ name: 'advertise-alive', headers, rinfo })
  })

  instance.on('advertise-bye', (headers, rinfo) => {
    report({ name: 'advertise-bye', headers, rinfo })
  })

  return instance
}

/**
 * A plain UDP socket on the SSDP port that joins the SSDP group on every
 * interface. It shares no code with the library, so it shows what is really
 * sent, and it can send packets that the library would never send.
 */
function createProbe () {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

  socket.on('message', (data, rinfo) => {
    const lines = data.toString().split('\r\n')
    const startLine = lines.shift()
    const headers = {}

    lines.forEach((line) => {
      const colon = line.indexOf(':')

      if (colon > 0) headers[line.slice(0, colon).toUpperCase()] = line.slice(colon + 1).trim()
    })

    report({ name: 'packet', startLine, headers, rinfo })
  })

  return {
    start () {
      return new Promise((resolve, reject) => {
        socket.once('error', reject)

        socket.bind(SSDP_PORT, () => {
          Object.values(os.networkInterfaces()).flat().forEach((info) => {
            if (info.family === 'IPv4' && !info.internal) socket.addMembership(SSDP_GROUP, info.address)
          })

          resolve()
        })
      })
    },

    stop () {
      socket.close()
    },

    send (lines) {
      return new Promise((resolve, reject) => {
        socket.send(lines.join('\r\n') + '\r\n\r\n', SSDP_PORT, SSDP_GROUP, (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  }
}

process.on('message', async ({ id, command, args }) => {
  try {
    if (command === 'create') {
      node = args[0] === 'probe' ? createProbe() : createSsdp(...args)
    } else {
      await node[command](...args)
    }

    process.send({ id })
  } catch (error) {
    process.send({ id, error: error.stack })
  }
})

// The test process closes the channel when it is done with this peer.
process.on('disconnect', () => process.exit(0))
