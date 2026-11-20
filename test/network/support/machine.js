'use strict'

// A machine that peers run on, and the peers themselves.
//
//   peer  A Node process that runs `agent.js`. It owns one SSDP server, one
//         SSDP client, one probe, or several servers in cluster workers.
//
// A `Machine` starts its peers on the machine that runs the tests. A host of
// the virtual network (see `lab.js`) is a `Machine` that starts its peers
// inside its network namespace.

const { spawn } = require('node:child_process')
const { once } = require('node:events')
const path = require('node:path')
const { setTimeout: sleep } = require('node:timers/promises')

const AGENT = path.join(__dirname, 'agent.js')

class Machine {
  constructor () {
    this._peers = []
  }

  /**
   * Creates an SSDP server on this machine. It is not started.
   *
   * The server answers a search at once, so that the tests are short.
   * Pass `mxDelay: true` for the delay that the library has by default.
   *
   * @param {Object} [opts] Options for the `Server` constructor
   * @param {String[]} [usns] Passed to `addUSN` one by one
   * @returns {Promise<Peer>}
   */
  server (opts, usns) {
    return this._peer('server', Object.assign({ mxDelay: false }, opts), usns || [])
  }

  /**
   * Creates an SSDP client on this machine. It is not started.
   *
   * @param {Object} [opts] Options for the `Client` constructor
   * @returns {Promise<Peer>}
   */
  client (opts) {
    return this._peer('client', opts || {}, [])
  }

  /**
   * Creates one process on this machine that runs an SSDP server in each of
   * several cluster workers. `start` starts all of them. Like `server`,
   * they answer a search at once.
   *
   * @param {Object} [opts] Options for the `Server` constructor
   * @param {String[]} [usns] Passed to `addUSN` of every server
   * @param {String[]} udns The UDN of each server
   * @returns {Promise<Peer>}
   */
  cluster (opts, usns, udns) {
    return this._peer('cluster', Object.assign({ mxDelay: false }, opts), usns || [], udns)
  }

  /**
   * Creates and starts a probe on this machine: a plain UDP socket on the
   * SSDP port. It does not use the library.
   *
   * It records every packet it receives as a `packet` event, so a test can
   * check what is really on the network. It can also send any packet to the
   * SSDP group with `send`.
   *
   * @returns {Promise<Peer>}
   */
  async probe () {
    const peer = await this._peer('probe')

    await peer.start()

    return peer
  }

  async closePeers () {
    const peers = this._peers

    this._peers = []

    await Promise.all(peers.map((peer) => peer.close()))
  }

  /**
   * Starts one Node process on this machine.
   *
   * @param {String[]} args Arguments for `node`
   * @param {Object} options Options for `spawn`
   * @returns {ChildProcess}
   */
  _spawn (args, options) {
    return spawn(process.execPath, args, options)
  }

  async _peer (kind, ...args) {
    const child = this._spawn([AGENT], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
    const peer = new Peer(child)

    this._peers.push(peer)

    await peer._call('create', kind, ...args)

    return peer
  }
}

class Peer {
  constructor (child) {
    /**
     * Every event the peer has reported so far, oldest first.
     *
     * A server or client reports `response`, `advertise-alive` and
     * `advertise-bye`: `{name, headers, statusCode, rinfo}`.
     * A probe reports `packet`: `{name, startLine, headers, rinfo}`.
     */
    this.events = []

    this._child = child
    this._calls = new Map()
    this._lastCall = 0
    this._watchers = new Set()

    child.on('message', (message) => {
      if (message.event) {
        this.events.push(message.event)
        this._watchers.forEach((watch) => watch())
        return
      }

      const call = this._calls.get(message.id)

      this._calls.delete(message.id)

      if (message.error) {
        call.reject(new Error('Peer failed: ' + message.error))
      } else {
        call.resolve()
      }
    })

    child.on('exit', (code, signal) => {
      this._calls.forEach((call) => call.reject(new Error('Peer exited: ' + (signal || 'code ' + code))))
      this._calls.clear()
    })
  }

  start () {
    return this._call('start')
  }

  stop () {
    return this._call('stop')
  }

  /**
   * Sends one packet from a probe to the SSDP group.
   *
   * @param {String[]} lines Start line and headers
   */
  send (lines) {
    return this._call('send', lines)
  }

  /**
   * Sends an M-SEARCH from a client.
   *
   * @param {String} serviceType
   * @param {Number} [wait] How long to wait for responses (ms)
   * @returns {Promise<Object[]>} `response` events that arrived in that time
   */
  async search (serviceType, wait) {
    const seen = this.events.length

    await this._call('search', serviceType)
    await sleep(wait || 300)

    return this.events.slice(seen).filter((event) => event.name === 'response')
  }

  /**
   * Waits, then returns the events with this name that arrived meanwhile.
   *
   * @param {String} name
   * @param {Number} ms
   * @returns {Promise<Object[]>}
   */
  async during (name, ms) {
    const seen = this.events.length

    await sleep(ms)

    return this.events.slice(seen).filter((event) => event.name === name)
  }

  /**
   * Returns the first event with this name that `match` accepts. Events that
   * arrived before this call count too. Fails when none arrives in time.
   *
   * @param {String} name
   * @param {Function} [match] Takes an event, returns true to accept it
   * @param {Number} [timeout] ms
   * @returns {Promise<Object>}
   */
  waitFor (name, match, timeout) {
    timeout = timeout || 3000

    return new Promise((resolve, reject) => {
      const watch = () => {
        const found = this.events.find((event) => event.name === name && (!match || match(event)))

        if (found) {
          clearTimeout(timer)
          this._watchers.delete(watch)
          resolve(found)
        }
      }

      const timer = setTimeout(() => {
        this._watchers.delete(watch)
        reject(new Error('No matching "' + name + '" event within ' + timeout + ' ms'))
      }, timeout)

      this._watchers.add(watch)
      watch()
    })
  }

  /**
   * Ends the peer process.
   */
  async close () {
    const child = this._child

    if (child.exitCode !== null || child.signalCode !== null) return

    const exited = once(child, 'exit')
    // The agent exits by itself when the IPC channel closes.
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000)

    if (child.connected) child.disconnect()

    await exited

    clearTimeout(timer)
  }

  _call (command, ...args) {
    return new Promise((resolve, reject) => {
      const id = ++this._lastCall

      this._calls.set(id, { resolve, reject })
      this._child.send({ id, command, args })
    })
  }
}

module.exports = { Machine }
