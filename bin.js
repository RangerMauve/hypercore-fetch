#!/usr/bin/env node

const eosp = require('end-of-stream-promise')
const { Readable } = require('streamx')

run()
  .catch((e) => process.nextTick(() => {
    throw e
  }))

async function run () {
  const fetch = require('./')()

  try {
    const url = process.argv[2]

    const response = await fetch(url)

    const stream = Readable.from(response.body)

    stream.pipe(process.stdout)

    await eosp(stream)
  } finally {
    fetch.close()
  }
}
