import * as SDK from 'hyper-sdk'
import test from 'tape'
import makeHyperFetch from './index.js'

const SAMPLE_CONTENT = 'Hello World'
let count = 0
function next () {
  return count++
}

const sdk1 = await SDK.create({ storage: false })
const sdk2 = await SDK.create({ storage: false })

const fetch = await makeHyperFetch({
  sdk: sdk1,
  writable: true
})

const fetch2 = await makeHyperFetch({
  sdk: sdk2,
  writable: true
})

test.onFinish(() => {
  sdk1.close()
  sdk2.close()
})

test('Quick check', async (t) => {
  const createResponse = await fetch(`hyper://localhost/?key=example${next()}`, {
    method: 'post'
  })

  await checkResponse(createResponse, t)

  const created = await createResponse.text()

  const existsResponse = await fetch(created)

  await checkResponse(existsResponse, t)

  t.deepEqual(await existsResponse.json(), [], 'Empty dir on create')

  const uploadLocation = new URL('./example.txt', created)

  const uploadResponse = await fetch(uploadLocation, {
    method: 'put',
    body: 'Hello World!'
  })

  await checkResponse(uploadResponse, t)

  const uploadedContentResponse = await fetch(uploadLocation)

  await checkResponse(uploadedContentResponse, t)

  const content = await uploadedContentResponse.text()

  t.equal(content, 'Hello World!')

  const dirResponse = await fetch2(created)

  await checkResponse(dirResponse, t)

  t.deepEqual(await dirResponse.json(), ['example.txt'], 'File got added')
})

test.skip('Read index.html', async (t) => {})
test.skip('PUT file', async (t) => {})
test.skip('PUT FormData', async (t) => {})
test.skip('PUT into new directory', async (t) => {})
test.skip('PUT to overwrite a file', async (t) => {})
test.skip('DELETE a file', async (t) => {})
test.skip('EventSource extension messages', async (t) => {})

/*

test('Read index.html', async (t) => {
  const archive = Hyperdrive('example1')

  const FILE_LOCATION = '/index.html'
  const FILE_DATA = '<h1>Hello World!</h1>'

  await archive.writeFile(FILE_LOCATION, FILE_DATA)

  const url = `hyper://${archive.key.toString('hex')}${FILE_LOCATION}`

  t.pass('Prepped archive ' + url)

  const response = await fetch(url)

  t.pass('got response')

  const text = await response.text()

  t.pass('got response text')

  const contentType = response.headers.get('content-type')

  t.equal(contentType, 'text/html; charset=utf-8')
  t.equal(text, FILE_DATA)
  t.pass('Headers ' + [...response.headers.entries()])
})

test('PUT file', async (t) => {
  const response1 = await fetch('hyper://example/checkthis.txt', { method: 'PUT', body: SAMPLE_CONTENT })

  t.equal(response1.status, 200, 'Got OK response on write')

  const response2 = await fetch('hyper://example/checkthis.txt')

  t.equal(response2.status, 200, 'Got OK response on read')

  t.equal(await response2.text(), SAMPLE_CONTENT, 'Read back written data')
})

test('PUT FormData to directory', async (t) => {
  const form = new FormData()

  form.append('file', SAMPLE_CONTENT, {
    filename: 'example.txt'
  })
  const body = form.getBuffer()
  const headers = form.getHeaders()

  const response1 = await fetch('hyper://example/foo/bar/', {
    method: 'PUT',
    headers,
    body
  })

  t.equal(response1.status, 200, 'Got OK response on directory upload')

  console.log(await response1.text())

  const response2 = await fetch('hyper://example/foo/bar/example.txt')

  t.equal(response2.status, 200, 'Got OK response on read')

  t.equal(await response2.text(), SAMPLE_CONTENT, 'Read back written data')
})

test('PUT file in new directory', async (t) => {
  const response1 = await fetch('hyper://example/fizz/buzz/example.txt', { method: 'PUT', body: SAMPLE_CONTENT })

  t.equal(response1.status, 200, 'Got OK response on directory/file creation')
})

test('PUT to overwrite a file', async (t) => {
  const response1 = await fetch('hyper://example/baz/index.html', { method: 'PUT', body: SAMPLE_CONTENT })
  t.ok(response1.ok)
  const response2 = await fetch('hyper://example/baz/index.html', { method: 'PUT', body: SAMPLE_CONTENT })

  t.equal(response2.status, 200, 'Got OK response on file overwrite')
})

test('DELETE file', async (t) => {
  const response1 = await fetch('hyper://example/test.txt', { method: 'PUT', body: SAMPLE_CONTENT })
  t.ok(response1.ok)

  const response2 = await fetch('hyper://example/test.txt', { method: 'DELETE' })

  t.equal(response2.status, 200, 'Got OK response on file delete')

  const response3 = await fetch('hyper://example/test.txt', { method: 'GET' })

  t.equal(response3.status, 404, 'Got not found on deleted file')
})

test('GET index.html', async (t) => {
  const response1 = await fetch('hyper://example/baz')

  t.equal(await response1.text(), SAMPLE_CONTENT, 'Got index.html content')

  const response2 = await fetch('hyper://example/baz?noResolve')

  t.equal(response2.headers.get('content-type'), 'application/json; charset=utf-8', 'noResolve flag yields JSON by default')
  t.deepEqual(await response2.json(), ['index.html'], 'Listed directory')

  const response3 = await fetch('hyper://example/baz?noResolve')
  t.equal(response3.headers.get('content-type'), 'application/json; charset=utf-8', 'noResolve flag yields JSON by default')
  t.deepEqual(await response3.json(), ['index.html'], 'Listed directory')
})

test('Load Mauve\'s blog', async (t) => {
  const response = await fetch('hyper://blog.mauve.moe/')

  t.ok(response.ok, 'Succesfully loaded homepage')
})

test('Watch for changes', async (t) => {
  const response = await fetch('hyper://example/', {
    headers: {
      Accept: 'text/event-stream'
    }
  })

  t.ok(response.ok, 'Able to open request')
  t.equal(response.headers.get('Content-Type'), 'text/event-stream', 'Response is event stream')

  const reader = await response.body.getReader()

  const [data] = await Promise.all([
    reader.read(),
    fetch('hyper://example/example4.txt', { method: 'PUT', body: 'Hello World' })
  ])

  t.ok(data.value, 'Got eventsource data after writing')
  t.ok(data.value.includes('event:change'), 'Eventsource data represents a change event')
  t.ok(data.value.endsWith('\n\n'), 'Ends with two newlines')

  await reader.cancel()
})

test('Send extension from one peer to another', async (t) => {
  const domainResponse = await fetch('hyper://example/.well-known/hyper')
  const domain = (await domainResponse.text()).split('\n')[0]

  const extensionURL = `${domain}/$/extensions/example`
  const extensionListURL = `${domain}/$/extensions/`

  // Load up extension message on peer 1
  await fetch(extensionURL)
  // Load up extension message on peer 2
  await fetch2(extensionURL)

  t.pass('Able to initialize extensions')

  const extensionListRequest = await fetch(extensionListURL)
  const extensionList = await extensionListRequest.json()

  // Extension list will always be alphabetically sorted
  t.deepEqual(extensionList, ['example', 'hypertrie'], 'Got expected list of extensions')

  // Wait a bit for them to connect
  // TODO: Peers API
  await delay(2000)

  const peerResponse1 = await fetch(extensionURL)
  const peerList1 = await peerResponse1.json()

  t.equal(peerList1.length, 1, 'Got one peer for extension message on peer1')

  const peerResponse2 = await fetch2(extensionURL)
  const peerList2 = await peerResponse2.json()

  t.equal(peerList2.length, 1, 'Got one peer for extension message on peer2')

  const eventRequest = await fetch(extensionListURL, {
    headers: {
      Accept: 'text/event-stream'
    }
  })

  t.ok(eventRequest.ok, 'Able to open request')
  t.equal(eventRequest.headers.get('Content-Type'), 'text/event-stream', 'Response is event stream')

  const reader = await eventRequest.body.getReader()

  const toRead = reader.read()

  await delay(500)

  const broadcastRequest = await fetch2(extensionURL, { method: 'POST', body: 'Hello World' })

  t.ok(broadcastRequest.ok, 'Able to broadcast to peers')

  const data = await toRead

  t.ok(data.value, 'Got eventsource data after writing')
  t.ok(data.value.includes('event:example\n'), 'EventSource data represents an example event')
  t.ok(data.value.includes('data:Hello World\n'), 'EventSource data contains expected body')
  t.ok(data.value.includes('id:'), 'EventSource data contains an ID')
  t.ok(data.value.endsWith('\n\n'), 'Ends with two newlines')

  await reader.cancel()
})

*/

function delay (time) {
  return new Promise((resolve) => setTimeout(resolve, time))
}

async function checkResponse (response, t, successMessage = 'Response OK') {
  if (!response.ok) {
    const message = await response.text()
    t.fail(new Error(`HTTP Error ${response.status}:\n${message}`))
  } else {
    t.pass(successMessage)
  }
}
