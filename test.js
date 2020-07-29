const storage = require('random-access-memory')
const SDK = require('dat-sdk')

async function test () {
  const { Hyperdrive, resolveName, close } = await SDK({
    storage
  })

  const archive = Hyperdrive('dat fetch test')

  const FILE_LOCATION = '/index.html'

  await archive.writeFile(FILE_LOCATION, '<h1>Hello World!</h1>')

  const fetch = require('./')({
    Hyperdrive,
    resolveName
  })

  const url = `dat://${archive.key.toString('hex')}${FILE_LOCATION}`

  console.log('Fetching from', url)

  const response = await fetch(url)

  const text = await response.text()

  const contentType = response.headers.get('content-type')

  console.log(contentType)
  console.log(text)

  const url2 = 'hyper://example/example.txt'
  const contents = 'Hello World'

  console.log('Putting into', url2, contents)

  await fetch(url2, { method: 'PUT', body: contents })

  console.log('Wrote to archive')

  const response2 = await fetch(url2)
  await checkOK(response2)
  const text2 = await response2.text()

  console.log('Read written data')
  console.log(text2)

  const url3 = 'hyper://example/'
  const response3 = await fetch(url3, { headers: { Accept: 'application/json' } })
  await checkOK(response3)
  const text3 = await response3.text()

  console.log('Directory listing after write')
  console.log(text3)

  await checkOK(await fetch(url2, { method: 'DELETE' }))

  console.log('Deleted file')

  const response4 = await fetch(url3)
  await checkOK(response4)
  const text4 = await response4.text()

  console.log('Directory after delete')
  console.log(text4)

  const url4 = 'hyper://example/index.json'

  const response5 = await fetch(url4)
  await checkOK(response5)
  const json = await response5.json()

  console.log('Created archive info', json)

  await close()
}

test().then(() => {
  process.exit(0)
}, (e) => {
  process.nextTick(() => {
    throw e
  })
})

async function checkOK (response) {
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message)
  }

  return response
}
