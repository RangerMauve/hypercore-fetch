const SDK = require('dat-sdk')

async function test () {
  const { Hyperdrive, resolveName, close } = await SDK({
    persist: false
  })

  try {
    const archive = Hyperdrive('example')

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

    const sampleContents = 'Hello World'

    // Gets
    console.log('\nGET TESTS')
    testItem(
      await (await fetch('hyper://example/.well-known/dat')).text(),
      'Check well-known dat'
    )
    testItem(
      (await fetch('hyper://example/checkthis.txt', { method: 'PUT', body: sampleContents })).status,
      'Put file to check',
      200
    )
    testItem(
      await (await fetch('hyper://example/checkthis.txt', { method: 'GET' })).text(),
      'Check written file',
      sampleContents
    )

    // Puts
    console.log('\nPUT TESTS')
    testItem(
      (await fetch('hyper://example/foo/bar/', { method: 'PUT' })).status,
      'Put directories',
      200
    )
    testItem(
      (await fetch('hyper://example/fizz/buzz/example.txt', { method: 'PUT', body: sampleContents })).status,
      'Put file under new directories',
      200
    )
    testItem(
      (await fetch('hyper://example/baz/index.html', { method: 'PUT', body: sampleContents })).status,
      'Put file',
      200
    )
    testItem(
      (await fetch('hyper://example/baz/index.html', { method: 'PUT', body: sampleContents })).status,
      'Put file over other',
      200
    )

    // Deletes
    console.log('\nDELETE TESTS')
    testItem(
      (await fetch('hyper://example/test.txt', { method: 'PUT', body: sampleContents })).status,
      'Create file for deletion',
      200
    )
    testItem(
      (await fetch('hyper://example/test.txt', { method: 'HEAD' })).status,
      'Check file',
      204
    )
    testItem(
      (await fetch('hyper://example/test.txt', { method: 'DELETE' })).status,
      'Delete file',
      200
    )
    testItem(
      (await fetch('hyper://example/test.txt', { method: 'GET' })).status,
      'Deleted file',
      404
    )

    // Directories
    console.log('\nDIRECTORY TESTS')
    testItem(
      await (await fetch('hyper://example/baz')).text(),
      'Resolve index',
      sampleContents
    )
    testItem(
      await (await fetch('hyper://example/baz', { headers: { 'X-Resolve': 'none' } })).text(),
      'Bypass resolve and recieve as JSON'
    )
    testItem(
      await (await fetch('hyper://example/baz', { headers: { 'X-Resolve': 'none', Accept: 'application/json' } })).json(),
      'Bypass resolve and recieve as JSON',
      ['index.html']
    )

    // Tags
    console.log('\nTAG TESTS')
    await fetch('hyper://example/test.txt', { method: 'PUT', body: 'test' })
    testItem(
      (await fetch('hyper://example/', { method: 'TAG', body: 'tag1' })).status,
      'Create tag',
      200
    )
    testItem(
      await (await fetch('hyper://example/', { method: 'TAGS' })).json(),
      'Get tags',
      { tag1: 12 }
    )
    testItem(
      await (await fetch('hyper://example+tag1/test.txt', { method: 'GET' })).text(),
      'Access tag',
      'test'
    )
    await fetch('hyper://example/notaccessible.txt', { method: 'PUT', body: 'test' })
    testItem(
      (await fetch('hyper://example+tag1/notaccessible.txt', { method: 'GET' })).status,
      'Fetch new data from old tag',
      404
    )
    testItem(
      (await fetch('hyper://example+tag1/', { method: 'TAG-DELETE' })).status,
      'Delete tag',
      200
    )
  } finally {
    await close()
  }
}

test().then(() => {
  process.exit(0)
}, (e) => {
  process.nextTick(() => {
    throw e
  })
})

function testItem (value, testname, expected) {
  value = JSON.stringify(value)
  expected = JSON.stringify(expected)
  if (expected && expected !== value) console.log(`!!! ${testname} failed, expected ${expected}; got ${value} !!!`)
  else console.log(`${testname} ${expected ? 'succeeded' : 'assumed to have succeeded'}`)
}
