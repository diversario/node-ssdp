'use strict'

// The recommended rules of ESLint. They find mistakes, for example a
// variable that is never used. They do not check code style.

const js = require('@eslint/js')
const globals = require('globals')

module.exports = [
  {
    ignores: ['coverage/']
  },
  js.configs.recommended,
  {
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node
    }
  },
  {
    // The examples show the arguments of a handler, also when the handler
    // does not use them.
    files: ['example/**'],
    rules: {
      'no-unused-vars': ['error', { args: 'none' }]
    }
  },
  {
    files: ['test/**'],
    languageOptions: {
      globals: globals.mocha
    }
  }
]
