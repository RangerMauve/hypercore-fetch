const DatArchive = require('node-dat-archive')
const fetch = require('./')(DatArchive, null)

const DAT_FOUNDATION = 'dat://60c525b5589a5099aa3610a8ee550dcd454c3e118f7ac93b7d41b6b850272330'

async function test () {
  const response = await fetch(DAT_FOUNDATION + "/")

  const text = await response.text()

  const contentType = response.headers.get('content-type')

  console.log(contentType)
  console.log(text)
}

test().then(() => {
  process.exit(0)
}, (e) => {
  process.nextTick(() => {
    throw e
  })
})
