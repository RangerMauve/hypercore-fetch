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

  const response8 = await fetch('hyper://example/baz', { headers: { 'X-Resolve': 'none' } })

  console.log('Bypassed resolve', await response8.text())

  // Tags
  console.log('TAG TESTS')
  await fetch('hyper://example/test.txt', {method:'PUT', body:'test'})
  testItem(
    (await fetch('hyper://example/', {method: 'TAG', body: 'tag1'})).status,
    'Create tag',
    200
  )
  testItem(
    await (await fetch('hyper://example/', {method: 'TAGS'})).json(),
    'Get tags',
    {tag1: 9}
  )
  testItem(
    await (await fetch('hyper://example+tag1/test.txt', {method: 'GET'})).text(),
    'Access tag',
    'test'
  )
  await fetch('hyper://example/notaccessible.txt', {method:'PUT', body:'test'})
  testItem(
    (await fetch('hyper://example+tag1/notaccessible.txt', {method: 'GET'})).status,
    'Fetch new data from old tag',
    404
  )
  testItem(
    (await fetch('hyper://example+tag1/', {method: 'TAG-DELETE'})).status,
    'Delete tag',
    200
  )

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

function testItem(value, testname, expected) {
  value = JSON.stringify(value)
  expected = JSON.stringify(expected)
  if(expected && expected != value) console.log(`!!! ${testname} failed, expected ${expected}; got ${value} !!!`)
  else console.log(`${testname} succeeded`)
}