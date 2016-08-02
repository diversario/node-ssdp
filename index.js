var path = process.env.SSDP_COV ? './lib-cov/' : ''

module.exports = {
  Client: require('./lib/client'),
  Base: require('./lib/index')
}
