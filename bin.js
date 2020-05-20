#!/usr/bin/env node

const eosp = require('end-of-stream-promise')

run()
  .catch((e) => process.nextTick(() => {
    throw e
  }))

async function run () {
  const fetch = require('./')()

  try {
    const url = process.argv[2]

    const response = await fetch(url)

    response.body.pipe(process.stdout)

    await eosp(response.body)
  } finally {
    fetch.close()
  }
}
