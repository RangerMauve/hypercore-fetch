const SDK = require('dat-sdk')

async function test () {
  const { Hyperdrive, resolveName, close } = await SDK({
    persist: false
  })

  const archive = Hyperdrive('dat fetch test')

  const FILE_LOCATION = '/index.html'

  await archive.writeFile(FILE_LOCATION, '<h1>Hello World!</h1>')

  const fetch = require('./')({
    Hyperdrive,
    resolveName,
    writable: true
  })

  const url = `dat://${archive.key.toString('hex')}${FILE_LOCATION}`

  console.log('Fetching from', url)

  const response = await fetch(url)

  const text = await response.text()

  const contentType = response.headers.get('content-type')

  console.log(contentType)
  console.log(text)
  console.log([...response.headers.entries()])

  const url2 = 'hyper://example/example.txt'
  const contents = 'Hello World'

  console.log('Putting into', url2, contents)

  await checkOK(await fetch(url2, { method: 'PUT', body: contents }))

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

  const url4 = 'hyper://example/.well-known/dat'

  const response5 = await fetch(url4)
  await checkOK(response5)
  const json = await response5.text()

  console.log('Archive well-known URL', json)

  const url5 = 'hyper://example/foo/bar/'
  await checkOK(await fetch(url5, { method: 'PUT' }))

  console.log('Created multiple folders')

  const url6 = 'hyper://example/fizz/buzz/example.txt'
  await checkOK(await fetch(url6, { method: 'PUT', body: contents }))

  console.log('Created file along with parent folders')

  const url7 = 'hyper://example/baz/index.html'
  await checkOK(await fetch(url7, { method: 'PUT', body: contents }))

  const response7 = await fetch('hyper://example/baz')

  console.log('Resolved index', await response7.text())

  const response8 = await fetch('hyper://example/baz', {headers: {'X-Resolve': 'none' }})

  console.log('Bypassed resolve', await response8.text())

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
