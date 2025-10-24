/* global FormData, Blob */
import * as SDK from 'hyper-sdk'
import test from 'tape'
import createEventSource from '@rangermauve/fetch-event-source'
import { once } from 'events'
import tmp from 'test-tmp'

import { join } from 'path'

import makeHyperFetch from './index.js'

const SAMPLE_CONTENT = 'Hello World'
const DNS_DOMAIN = 'blog.mauve.moe'
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

const tmpDir = await tmp()

const sdk1 = await SDK.create({ storage: join(tmpDir, 'sdk1') })
const sdk2 = await SDK.create({ storage: join(tmpDir, 'sdk2') })

const fetch = await makeHyperFetch({
  sdk: sdk1,
  writable: true
})

const fetch2 = await makeHyperFetch({
  sdk: sdk2,
  writable: true
})

test.onFinish(async () => {
  await Promise.all([
    sdk1.close(),
    sdk2.close()
  ])
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

  const uploadLocation = new URL('./example .txt', created)

  const uploadResponse = await fetch(uploadLocation, {
    method: 'put',
    body: SAMPLE_CONTENT
  })

  await checkResponse(uploadResponse, t)

  const uploadedContentResponse = await fetch(uploadLocation)

  await checkResponse(uploadedContentResponse, t)

  const content = await uploadedContentResponse.text()
  const contentType = uploadedContentResponse.headers.get('Content-Type')
  const contentLink = uploadedContentResponse.headers.get('Link')

  t.match(contentLink, /^<hyper:\/\/[0-9a-z]{52}\/example%20.txt>; rel="canonical"$/, 'Link header includes both public key and path.')
  t.equal(contentType, 'text/plain; charset=utf-8', 'Content got expected mime type')
  t.equal(content, SAMPLE_CONTENT, 'Got uploaded content back out')

  const dirResponse = await fetch2(created)

  await checkResponse(dirResponse, t)

  t.deepEqual(await dirResponse.json(), ['example .txt'], 'File got added')
})

test('GET full url for created keys', async (t) => {
  const keyURL = `hyper://localhost/?key=example${next()}`

  const createResponse = await fetch(keyURL, { method: 'post' })
  await checkResponse(createResponse, t, 'Able to create drive')

  const createdURL = await createResponse.text()

  t.ok(createdURL.startsWith('hyper://'), 'Got new hyper:// URL')

  const nowExistingResponse = await fetch(keyURL)
  await checkResponse(nowExistingResponse, t, 'GET no longer fails on create')

  const existingURL = await nowExistingResponse.text()

  t.equal(existingURL, createdURL, 'URL same as in initial create')
})

test('HEAD request', async (t) => {
  const created = await nextURL(t)
  const uploadLocation = new URL('./example.txt', created)
  await fetch(uploadLocation, { method: 'put', body: SAMPLE_CONTENT })

  const headResponse = await fetch(uploadLocation, { method: 'head' })

  await checkResponse(headResponse, t, 'Able to load HEAD')

  const headersEtag = headResponse.headers.get('Etag')
  const headersContentType = headResponse.headers.get('Content-Type')
  const headersContentLength = headResponse.headers.get('Content-Length')
  const headersAcceptRanges = headResponse.headers.get('Accept-Ranges')
  const headersLastModified = headResponse.headers.get('Last-Modified')
  const headersLink = headResponse.headers.get('Link')

  t.equal(headResponse.status, 204, 'Response had expected status')
  // Version at which the file was added
  t.equal(headersEtag, '2', 'Headers got expected etag')
  t.equal(headersContentType, 'text/plain; charset=utf-8', 'Headers got expected mime type')
  t.ok(headersContentLength, "Headers have 'Content-Length' set.")
  t.ok(headersLastModified, "Headers have 'Last-Modified' set.")
  t.equal(headersAcceptRanges, 'bytes')
  t.match(headersLink, /^<hyper:\/\/[0-9a-z]{52}\/example.txt>; rel="canonical"$/, 'Link header includes both public key and path.')
})

test('PUT file', async (t) => {
  const created = await nextURL(t)

  const uploadLocation = new URL('./example.txt', created)

  const fakeDate = new Date(Date.parse(0)).toUTCString()
  const uploadResponse = await fetch(uploadLocation, {
    method: 'put',
    body: SAMPLE_CONTENT,
    headers: {
      'Last-Modified': fakeDate
    }
  })

  await checkResponse(uploadResponse, t, 'upload successful')

  const uploadedContentResponse = await fetch(uploadLocation)

  await checkResponse(uploadedContentResponse, t, 'able to load content')

  const content = await uploadedContentResponse.text()
  const contentType = uploadedContentResponse.headers.get('Content-Type')
  const lastModified = uploadedContentResponse.headers.get('Last-Modified')

  t.equal(contentType, 'text/plain; charset=utf-8', 'Content got expected mime type')
  t.equal(content, SAMPLE_CONTENT, 'Got uploaded content back out')
  t.equal(lastModified, fakeDate, 'Last-Modified header was set to value of Date header')
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

  const topDirResponse = await fetch(created)
  await checkResponse(topDirResponse, t)
  const topDirEntries = await topDirResponse.json()
  t.deepEqual(topDirEntries, ['subfolder/'], 'subdirectory is listed')

  const subDir = new URL('./subfolder/', created)
  const subDirResponse = await fetch(subDir)
  await checkResponse(subDirResponse, t)
  const subDirEntries = await subDirResponse.json()
  t.deepEqual(subDirEntries, ['example.txt'], 'new file is listed')
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

  const deleteResponse = await fetch(uploadLocation, {
    method: 'delete'
  })
  await checkResponse(deleteResponse, t, 'Able to DELETE')

  const listDirRequest = await fetch(created)
  await checkResponse(listDirRequest, t)
  const entries = await listDirRequest.json()
  t.deepEqual(entries, [], 'subfolder got deleted')
})
test.skip('DELETE a drive from storage', async (t) => {
  const created = await nextURL(t)

  const uploadLocation = new URL('./subfolder/example.txt', created)
  const uploadResponse = await fetch(uploadLocation, {
    method: 'put',
    body: SAMPLE_CONTENT
  })
  await checkResponse(uploadResponse, t)

  const purgeResponse = await fetch(created, { method: 'delete' })

  await checkResponse(purgeResponse, t, 'Able to purge')

  const listDirRequest = await fetch(created)

  t.notOk(listDirRequest.ok, 'Error when trying to read after purge')
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
test('Ensure that noResolve works with file paths', async (t) => {
  const created = await nextURL(t)
  const uploadLocation = new URL('./example.txt', created)
  const uploadResponse = await fetch(uploadLocation, {
    method: 'put',
    body: SAMPLE_CONTENT
  })
  await checkResponse(uploadResponse, t)

  const noResolve = uploadLocation.href + '?noResolve'
  const getRequest = await fetch(noResolve)
  await checkResponse(getRequest, t)

  const headRequest = await fetch(noResolve, { method: 'HEAD' })
  await checkResponse(headRequest, t)
})
test('Render index.gmi', async (t) => {
  const created = await nextURL(t)
  const uploadLocation = new URL('./index.gmi', created)

  const uploadResponse = await fetch(uploadLocation, {
    method: 'put',
    body: SAMPLE_CONTENT
  })
  await checkResponse(uploadResponse, t)

  const uploadedContentResponse = await fetch(created)

  await checkResponse(uploadedContentResponse, t)

  const content = await uploadedContentResponse.text()
  const contentType = uploadedContentResponse.headers.get('Content-Type')

  t.equal(contentType, 'text/gemini; charset=utf-8', 'got HTML mime type')
  t.equal(content, SAMPLE_CONTENT, 'loaded index.html content')
})
test('Read directory as HTML', async (t) => {
  const created = await nextURL(t)

  const formData = new FormData()
  formData.append('file', new Blob([SAMPLE_CONTENT]), 'example.txt')
  formData.append('file', new Blob([SAMPLE_CONTENT]), 'example2.txt')

  const uploadedResponse = await fetch(created, {
    method: 'put',
    body: formData
  })
  await checkResponse(uploadedResponse, t)

  const listDirRequest = await fetch(created, {
    headers: {
      Accept: 'text/html'
    }
  })
  await checkResponse(listDirRequest, t, 'Able to list HTML')

  const html = await listDirRequest.text()

  t.equal(listDirRequest.headers.get('Content-Type'), 'text/html; charset=utf-8', 'Returned HTML in mime type')
  t.ok(html.includes('<title'), 'Listing has title')
  t.ok(html.includes('./example.txt'), 'Listing has link to file')
})
test('Resolve pretty markdown URLs', async (t) => {
  const created = await nextURL(t)

  const uploadLocation = new URL('./example.md', created)

  const uploadResponse = await fetch(uploadLocation, {
    method: 'put',
    body: SAMPLE_CONTENT
  })
  await checkResponse(uploadResponse, t)

  const resolvedLocation = new URL('/example', created)

  const uploadedContentResponse = await fetch(resolvedLocation)

  await checkResponse(uploadedContentResponse, t, 'able to load content')

  const content = await uploadedContentResponse.text()
  const contentType = uploadedContentResponse.headers.get('Content-Type')

  t.equal(content, SAMPLE_CONTENT, 'Got original content out')
  t.equal(contentType, 'text/markdown; charset=utf-8', 'Got markdown mime type')
})

test('EventSource extension messages', async (t) => {
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

  const peerResponse1 = await fetch(extensionURL)
  const peerList1 = await peerResponse1.json()

  t.equal(peerList1.length, 1, 'Got one peer for extension message on peer1')

  const peerResponse2 = await fetch2(extensionURL)
  const peerList2 = await peerResponse2.json()

  t.equal(peerList2.length, 1, 'Got one peer for extension message on peer2')

  const { EventSource } = createEventSource(fetch)
  const source = new EventSource(extensionListURL)

  await Promise.race([
    once(source, 'open'),
    once(source, 'error').then(([e]) => { throw e })
  ])

  const toRead = Promise.race([
    once(source, 'example'),
    once(source, 'error').then(([e]) => { throw e })
  ])

  const broadcastRequest = await fetch2(extensionURL, { method: 'POST', body: SAMPLE_CONTENT })

  t.ok(broadcastRequest.ok, 'Able to broadcast to peers')

  const [event] = await toRead

  const { type, data, lastEventId } = event

  t.equal(data, SAMPLE_CONTENT, 'Got data from event')
  t.equal(type, 'example', 'Event got set to extension message name')
  t.ok(lastEventId, 'Event contained peer ID')
})

test('Resolve DNS', async (t) => {
  const loadResponse = await fetch(`hyper://${DNS_DOMAIN}/?noResolve`)

  const entries = await loadResponse.json()

  t.ok(entries.length, 'Loaded contents with some files present')

  const rawLink = loadResponse.headers.get('Link').match(/<(.+)>/)[1]
  const loadRawURLResponse = await fetch(rawLink + '?noResolve')

  const rawLinkEntries = await loadRawURLResponse.json()
  t.deepEqual(rawLinkEntries, entries, 'Raw link resolves to same content as DNS domain.')
})

test('Doing a `GET` on an invalid domain/public key should cause an error', async (t) => {
  const invalidDomainResponse = await fetch('hyper://example/')
  t.notOk(invalidDomainResponse.ok, 'Response errored out due to invalid domain')

  const invalidPublicKeyResponse = await fetch('hyper://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/')
  t.notOk(invalidPublicKeyResponse.ok, 'Response errored out due to invalid public key')
  t.equal(invalidPublicKeyResponse.status, 404, 'Invalid public key should error')
})

test('Old versions in VERSION folder', async (t) => {
  const created = await nextURL(t)

  const fileName = 'example.txt'

  const data1 = 'Hello World'
  const data2 = 'Goodbye World'

  const fileURL = new URL(`/${fileName}`, created)
  const versionFileURL = new URL(`/$/version/2/${fileName}`, created)
  const versionRootURL = new URL('/$/version/1/', created)

  await checkResponse(
    await fetch(fileURL, { method: 'PUT', body: data1 }), t
  )
  await checkResponse(
    await fetch(fileURL, { method: 'PUT', body: data2 }), t
  )

  const versionedFileResponse = await fetch(versionFileURL)
  await checkResponse(versionedFileResponse, t, 'Able to GET versioned file')
  const versionedFileData = await versionedFileResponse.text()
  t.equal(versionedFileData, data1, 'Old data got loaded')

  const versionedRootResponse = await fetch(versionRootURL)
  await checkResponse(versionedRootResponse, t, 'Able to GET versioned root')
  const versionedRootContents = await versionedRootResponse.json()
  t.deepEqual(versionedRootContents, [], 'Old root content got loaded')

  // PUT on old version should fail
  const putResponse = await fetch(versionFileURL, {
    method: 'PUT',
    body: SAMPLE_CONTENT
  })
  if (putResponse.ok) {
    throw new Error('PUT old version of file should have failed')
  } else {
    t.equal(putResponse.status, 405, 'PUT old version returned status 405 Not Allowed')
  }

  // DELETE on old version should fail
  const deleteResponse = await fetch(versionFileURL, {
    method: 'delete'
  })
  if (deleteResponse.ok) {
    throw new Error('DELETE old version of file should have failed')
  } else {
    t.equal(deleteResponse.status, 405, 'DELETE old version returned status 405 Not Allowed')
  }
})

test('Handle empty string pathname', async (t) => {
  const created = await nextURL(t)
  const urlObject = new URL('', created)
  const urlNoTrailingSlash = urlObject.href.slice(0, -1)
  const versionedURLObject = new URL('/$/version/3/', created)
  const versionedURLNoTrailingSlash = versionedURLObject.href.slice(0, -1)

  // PUT
  const putResponse = await fetch(urlNoTrailingSlash, { method: 'PUT', body: SAMPLE_CONTENT })
  if (putResponse.ok) {
    throw new Error('PUT file at the root directory should have failed')
  } else {
    t.pass('PUT file at root directory threw an error')
  }

  // PUT FormData
  const formData = new FormData()
  formData.append('file', new Blob([SAMPLE_CONTENT]), 'example.txt')
  formData.append('file', new Blob([SAMPLE_CONTENT]), 'example2.txt')

  await checkResponse(
    await fetch(urlNoTrailingSlash, {
      method: 'put',
      body: formData
    }),
    t
  )

  // HEAD (versioned)
  const versionedHeadResponse = await fetch(versionedURLNoTrailingSlash, { method: 'HEAD' })
  await checkResponse(versionedHeadResponse, t)
  t.deepEqual(versionedHeadResponse.headers.get('Etag'), '3', 'Versioned HEAD request returns correct Etag')

  // GET
  const getResponse = await fetch(urlNoTrailingSlash)
  await checkResponse(getResponse, t)
  t.deepEqual(await getResponse.json(), ['example.txt', 'example2.txt'], 'Returns directory listing')

  // GET (versioned)
  const versionedGetResponse = await fetch(versionedURLNoTrailingSlash)
  await checkResponse(versionedGetResponse, t)
  t.deepEqual(await versionedGetResponse.json(), ['example.txt', 'example2.txt'], 'Returns root directory prior to DELETE')

  // DELETE
  // await checkResponse(await fetch(urlNoTrailingSlash, { method: 'DELETE' }), t, 'Able to delete root')
})

test('Return status 403 Forbidden on attempt to modify read-only hyperdrive', async (t) => {
  const readOnlyURL = `hyper://${DNS_DOMAIN}/new-file.txt`
  const putResponse = await fetch(readOnlyURL, { method: 'PUT', body: SAMPLE_CONTENT })
  if (putResponse.ok) {
    throw new Error('PUT file to read-only drive should have failed')
  } else {
    t.equal(putResponse.status, 403, 'PUT file to read-only drive returned status 403 Forbidden')
  }

  const deleteResponse = await fetch(readOnlyURL, { method: 'DELETE' })
  if (deleteResponse.ok) {
    throw new Error('DELETE file in read-only drive should have failed')
  } else {
    t.equal(deleteResponse.status, 403, 'DELETE file to read-only drive returned status 403 Forbidden')
  }
})

test('Check hyperdrive writability', async (t) => {
  const created = await nextURL(t)

  const readOnlyRootDirectory = `hyper://${DNS_DOMAIN}/?noResolve`
  const readOnlyHeadResponse = await fetch(readOnlyRootDirectory, { method: 'HEAD' })
  await checkResponse(readOnlyHeadResponse, t, 'Able to load HEAD')
  const readOnlyHeadersAllow = readOnlyHeadResponse.headers.get('Allow')
  t.equal(readOnlyHeadersAllow, 'HEAD,GET', 'Expected read-only Allows header')

  const writableHeadResponse = await fetch(created, { method: 'HEAD' })
  await checkResponse(writableHeadResponse, t, 'Able to load HEAD')
  const writableHeadersAllow = writableHeadResponse.headers.get('Allow')
  t.equal(writableHeadersAllow, 'HEAD,GET,PUT,DELETE', 'Expected writable Allows header')
})

test('Able to open drive by URL if previously opened by name', async (t) => {
  const storage = await tmp()
  let sdk = await SDK.create({ storage })
  try {
    let fetch = await makeHyperFetch({
      sdk,
      writable: true
    })

    const createResponse = await fetch(`hyper://localhost/?key=example${next()}`, {
      method: 'post'
    })
    await checkResponse(createResponse, t, 'Created new drive')

    const created = await createResponse.text()

    const uploadLocation = new URL('./example.txt', created)

    const uploadResponse = await fetch(uploadLocation, {
      method: 'put',
      body: SAMPLE_CONTENT
    })

    await checkResponse(uploadResponse, t)

    await sdk.close()

    sdk = await SDK.create({ storage })
    fetch = await makeHyperFetch({
      sdk,
      writable: true
    })

    const listDirRequest = await fetch(created)
    await checkResponse(listDirRequest, t)
    const entries = await listDirRequest.json()
    t.deepEqual(entries, ['example.txt'], 'files are listed')
  } finally {
    await sdk.close()
  }
})

async function checkResponse (response, t, successMessage = 'Response OK') {
  if (!response.ok) {
    const message = await response.text()
    t.fail(new Error(`HTTP Error ${response.status}:\n${message}`))
    return false
  } else {
    t.pass(successMessage)
    return true
  }
}
