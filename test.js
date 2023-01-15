/* global FormData, Blob */
import * as SDK from 'hyper-sdk'
import test from 'tape'
import createEventSource from '@rangermauve/fetch-event-source'
import { once } from 'events'

import makeHyperFetch from './index.js'

const SAMPLE_CONTENT = 'Hello World'
let count = 0
function next () {
  return count++
}

async function nextURL (t) {
  const createResponse = await fetch(`hyper://localhost/?key=example${next()}`, {
    method: 'post'
  })
  await checkResponse(createResponse, t, 'Created new drive')

  const created = await createResponse.text()
  return created
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

  await checkResponse(createResponse, t, 'Created new drive')

  const created = await createResponse.text()

  t.ok(created.startsWith('hyper://'), 'Created drive has hyper URL')

  const existsResponse = await fetch(created)

  await checkResponse(existsResponse, t)

  t.deepEqual(await existsResponse.json(), [], 'Empty dir on create')

  const uploadLocation = new URL('./example.txt', created)

  const uploadResponse = await fetch(uploadLocation, {
    method: 'put',
    body: SAMPLE_CONTENT
  })

  await checkResponse(uploadResponse, t)

  const uploadedContentResponse = await fetch(uploadLocation)

  await checkResponse(uploadedContentResponse, t)

  const content = await uploadedContentResponse.text()
  const contentType = uploadedContentResponse.headers.get('Content-Type')

  t.equal(contentType, 'text/plain; charset=utf-8', 'Content got expected mime type')
  t.equal(content, SAMPLE_CONTENT, 'Got uploaded content back out')

  const dirResponse = await fetch2(created)

  await checkResponse(dirResponse, t)

  t.deepEqual(await dirResponse.json(), ['example.txt'], 'File got added')
})

test('PUT file', async (t) => {
  const created = await nextURL(t)

  const uploadLocation = new URL('./example.txt', created)

  const uploadResponse = await fetch(uploadLocation, {
    method: 'put',
    body: SAMPLE_CONTENT
  })

  await checkResponse(uploadResponse, t)

  const uploadedContentResponse = await fetch(uploadLocation)

  await checkResponse(uploadedContentResponse, t)

  const content = await uploadedContentResponse.text()
  const contentType = uploadedContentResponse.headers.get('Content-Type')

  t.equal(contentType, 'text/plain; charset=utf-8', 'Content got expected mime type')
  t.equal(content, SAMPLE_CONTENT, 'Got uploaded content back out')
})
test('PUT FormData', async (t) => {
  const created = await nextURL(t)

  const formData = new FormData()
  formData.append('file', new Blob([SAMPLE_CONTENT]), 'example.txt')
  formData.append('file', new Blob([SAMPLE_CONTENT]), 'example2.txt')

  const uploadedResponse = await fetch(created, {
    method: 'put',
    body: formData
  })

  await checkResponse(uploadedResponse, t)

  const file2URL = new URL('/example2.txt', created)
  const file2Response = await fetch(file2URL)

  await checkResponse(file2Response, t)
  const file2Content = await file2Response.text()

  t.equal(file2Content, SAMPLE_CONTENT, 'file contents got uploaded')

  const listDirRequest = await fetch(created)
  await checkResponse(listDirRequest, t)
  const entries = await listDirRequest.json()
  t.deepEqual(entries, ['example.txt', 'example2.txt'], 'new files are listed')
})
test('PUT into new directory', async (t) => {
  const created = await nextURL(t)

  const uploadLocation = new URL('./subfolder/example.txt', created)

  const uploadResponse = await fetch(uploadLocation, {
    method: 'put',
    body: SAMPLE_CONTENT
  })

  await checkResponse(uploadResponse, t)

  const uploadedContentResponse = await fetch(uploadLocation)

  await checkResponse(uploadedContentResponse, t)

  const content = await uploadedContentResponse.text()
  const contentType = uploadedContentResponse.headers.get('Content-Type')

  t.equal(contentType, 'text/plain; charset=utf-8', 'Content got expected mime type')
  t.equal(content, SAMPLE_CONTENT, 'Got uploaded content back out')

  const listDirRequest = await fetch(created)
  await checkResponse(listDirRequest, t)
  const entries = await listDirRequest.json()
  t.deepEqual(entries, ['subfolder/'], 'new files are listed')
})
test('PUT to overwrite a file', async (t) => {
  const created = await nextURL(t)

  const uploadLocation = new URL('./example.txt', created)

  const uploadResponse = await fetch(uploadLocation, {
    method: 'put',
    body: SAMPLE_CONTENT
  })
  await checkResponse(uploadResponse, t)

  const SHORTER_CONTENT = 'Hello'

  const overWriteResponse = await fetch(uploadLocation, {
    method: 'put',
    body: SHORTER_CONTENT
  })
  await checkResponse(overWriteResponse, t)

  const uploadedContentResponse = await fetch(uploadLocation)

  await checkResponse(uploadedContentResponse, t)

  const content = await uploadedContentResponse.text()
  const contentType = uploadedContentResponse.headers.get('Content-Type')

  t.equal(contentType, 'text/plain; charset=utf-8', 'Content got expected mime type')
  t.equal(content, SHORTER_CONTENT, 'Got uploaded content back out')
})
test('DELETE a file', async (t) => {
  const created = await nextURL(t)

  const formData = new FormData()
  formData.append('file', new Blob([SAMPLE_CONTENT]), 'example.txt')
  formData.append('file', new Blob([SAMPLE_CONTENT]), 'example2.txt')

  const uploadedResponse = await fetch(created, {
    method: 'put',
    body: formData
  })
  await checkResponse(uploadedResponse, t)

  const file2URL = new URL('/example2.txt', created)
  const deleteResponse = await fetch(file2URL, {
    method: 'delete'
  })

  await checkResponse(deleteResponse, t, 'Able to DELETE')

  const dirResponse = await fetch(created)

  await checkResponse(dirResponse, t)

  t.deepEqual(await dirResponse.json(), ['example.txt'], 'Only one file remains')
})
test('DELETE a directory', async (t) => {
  const created = await nextURL(t)

  const uploadLocation = new URL('./subfolder/example.txt', created)

  const uploadResponse = await fetch(uploadLocation, {
    method: 'put',
    body: SAMPLE_CONTENT
  })
  await checkResponse(uploadResponse, t)

  const deleteResponse = await fetch(created, {
    method: 'delete'
  })
  await checkResponse(deleteResponse, t, 'Able to DELETE')

  const listDirRequest = await fetch(created)
  await checkResponse(listDirRequest, t)
  const entries = await listDirRequest.json()
  t.deepEqual(entries, [], 'subfolder got deleted')
})
test('Read index.html', async (t) => {
  const created = await nextURL(t)
  const uploadLocation = new URL('./index.html', created)

  const uploadResponse = await fetch(uploadLocation, {
    method: 'put',
    body: SAMPLE_CONTENT
  })
  await checkResponse(uploadResponse, t)

  const uploadedContentResponse = await fetch(uploadLocation)

  await checkResponse(uploadedContentResponse, t)

  const content = await uploadedContentResponse.text()
  const contentType = uploadedContentResponse.headers.get('Content-Type')

  t.equal(contentType, 'text/html; charset=utf-8', 'got HTML mime type')
  t.equal(content, SAMPLE_CONTENT, 'loaded index.html content')
})
test('Ignore index.html with noResolve', async (t) => {
  const created = await nextURL(t)
  const uploadLocation = new URL('./index.html', created)

  const uploadResponse = await fetch(uploadLocation, {
    method: 'put',
    body: SAMPLE_CONTENT
  })
  await checkResponse(uploadResponse, t)

  const noResolve = created + '?noResolve'

  const listDirRequest = await fetch(noResolve)
  await checkResponse(listDirRequest, t)
  const entries = await listDirRequest.json()
  t.deepEqual(entries, ['index.html'], 'able to list index.html')
})
test.skip('Read directory as HTML', async (t) => {

})

test.only('EventSource extension messages', async (t) => {
  const domain = await nextURL(t)

  const extensionURL = `${domain}$/extensions/example`
  const extensionListURL = `${domain}$/extensions/`

  // Load up extension message on peer 1
  const extensionLoadResponse1 = await fetch(extensionURL)
  await checkResponse(extensionLoadResponse1, t)
  // Load up extension message on peer 2
  const extensionLoadResponse2 = await fetch2(extensionURL)
  await checkResponse(extensionLoadResponse2, t)

  const extensionListRequest = await fetch(extensionListURL)
  const extensionList = await extensionListRequest.json()

  // Extension list will always be alphabetically sorted
  t.deepEqual(extensionList, ['example'], 'Got expected list of extensions')

  return

  // Wait a bit for them to connect
  // TODO: Peers API
  await delay(2000)

  const peerResponse1 = await fetch(extensionURL)
  const peerList1 = await peerResponse1.json()

  t.equal(peerList1.length, 1, 'Got one peer for extension message on peer1')

  const peerResponse2 = await fetch2(extensionURL)
  const peerList2 = await peerResponse2.json()

  t.equal(peerList2.length, 1, 'Got one peer for extension message on peer2')

  return

  const { EventSource } = createEventSource(fetch)
  const source = new EventSource(extensionListURL)

  await Promise.race([
    once(source, 'open'),
    once(source, 'error').then(([e]) => { throw e })
  ])

  const toRead = Promise.race([
    once(source, 'message'),
    once(source, 'error').then(([e]) => { throw e })
  ])

  // await delay(500)

  const broadcastRequest = await fetch2(extensionURL, { method: 'POST', body: 'Hello World' })

  t.ok(broadcastRequest.ok, 'Able to broadcast to peers')

  const [data] = await toRead

  console.log(data)

  t.ok(data.value, 'Got eventsource data after writing')
  t.ok(data.value.includes('event:example\n'), 'EventSource data represents an example event')
  t.ok(data.value.includes('data:Hello World\n'), 'EventSource data contains expected body')
  t.ok(data.value.includes('id:'), 'EventSource data contains an ID')
  t.ok(data.value.endsWith('\n\n'), 'Ends with two newlines')
})

async function checkResponse (response, t, successMessage = 'Response OK') {
  if (!response.ok) {
    const message = await response.text()
    t.fail(new Error(`HTTP Error ${response.status}:\n${message}`))
  } else {
    t.pass(successMessage)
  }
}
