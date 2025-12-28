import { posix } from 'path'

// @ts-ignore
import { Readable, pipelinePromise } from 'streamx'
import { makeRoutedFetch } from 'make-fetch'
import mime from 'mime/index.js'
import parseRange from 'range-parser'
import { EventIterator } from 'event-iterator'

/** @import Hypercore from 'hypercore' */
/** @import Hyperdrive from 'hyperdrive' */

/** @typedef {(url: URL, files: string[], fetch: typeof globalThis.fetch) => Promise<string>} RenderIndexHandler */
/** @typedef {(url: URL, writable: boolean, name?: string) => void}  OnLoadHandler */
/** @typedef {(url: URL) => void} OnDeleteHandler */

const DEFAULT_TIMEOUT = 5000

const SPECIAL_DOMAIN = 'localhost'
const SPECIAL_FOLDER = '$'
const EXTENSIONS_FOLDER_NAME = 'extensions'
const EXTENSION_EVENT = 'extension-message'
const VERSION_FOLDER_NAME = 'version'
const PEER_OPEN = 'peer-open'
const PEER_REMOVE = 'peer-remove'

const MIME_TEXT_PLAIN = 'text/plain; charset=utf-8'
const MIME_APPLICATION_JSON = 'application/json'
const MIME_TEXT_HTML = 'text/html; charset=utf-8'
const MIME_EVENT_STREAM = 'text/event-stream; charset=utf-8'

const HEADER_CONTENT_TYPE = 'Content-Type'
const HEADER_LAST_MODIFIED = 'Last-Modified'

const WRITABLE_METHODS = [
  'PUT',
  'DELETE'
]

const BASIC_METHODS = [
  'HEAD',
  'GET'
]

export const ERROR_KEY_NOT_CREATED = 'Must create key with POST before reading'
export const ERROR_DRIVE_EMPTY = 'Could not find data in drive, make sure your key is correct and that there are peers online to load data from'

const INDEX_FILES = [
  'index.html',
  'index.md',
  'index.gmi',
  'index.gemini',
  'index.org',
  'README.md',
  'README.org'
]

/** @type {RenderIndexHandler} */
async function DEFAULT_RENDER_INDEX (url, files, fetch) {
  return `
<!DOCTYPE html>
<title>Index of ${url.pathname}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<h1>Index of ${url.pathname}</h1>
<ul>
  <li><a href="../">../</a></li>
  ${files.map((file) => `<li><a href="${file}">./${file}</a></li>`).join('\n')}
</ul>
`
}

// Support gemini files
mime.define({
  'text/gemini': ['gmi', 'gemini']
}, true)

function noop () {}

/**
 *
 * @param {object} options
 * @param {import('hyper-sdk').SDK} options.sdk
 * @param {boolean} [options.writable]
 * @param {boolean} [options.extensionMessages]
 * @param {number} [options.timeout]
 * @param {typeof DEFAULT_RENDER_INDEX} [options.renderIndex]
 * @param {OnLoadHandler} [options.onLoad]
 * @param {OnDeleteHandler} [options.onDelete]
 * @returns {Promise<typeof globalThis.fetch>}
 */
export default async function makeHyperFetch ({
  sdk,
  writable = false,
  extensionMessages = writable,
  timeout = DEFAULT_TIMEOUT,
  renderIndex = DEFAULT_RENDER_INDEX,
  onLoad = noop,
  onDelete = noop
}) {
  const { fetch, router } = makeRoutedFetch({
    onError
  })

  // Map loaded drive hostnames to their keys
  // TODO: Track LRU + cache clearing
  const extensions = new Map()

  if (extensionMessages) {
    router.get(`hyper://*/${SPECIAL_FOLDER}/${EXTENSIONS_FOLDER_NAME}/`, listExtensions)
    router.get(`hyper://*/${SPECIAL_FOLDER}/${EXTENSIONS_FOLDER_NAME}/*`, listenExtension)
    router.post(`hyper://*/${SPECIAL_FOLDER}/${EXTENSIONS_FOLDER_NAME}/*`, broadcastExtension)
    router.post(`hyper://*/${SPECIAL_FOLDER}/${EXTENSIONS_FOLDER_NAME}/*/*`, extensionToPeer)
  }

  if (writable) {
    router.get(`hyper://${SPECIAL_DOMAIN}/`, getKey)
    router.post(`hyper://${SPECIAL_DOMAIN}/`, createKey)

    router.put(`hyper://*/${SPECIAL_FOLDER}/${VERSION_FOLDER_NAME}/**`, putFilesVersioned)
    router.put('hyper://*/**', putFiles)
    router.delete('hyper://*/', deleteDrive)
    router.delete(`hyper://*/${SPECIAL_FOLDER}/${VERSION_FOLDER_NAME}/**`, deleteFilesVersioned)
    router.delete('hyper://*/**', deleteFiles)
  }

  router.head(`hyper://*/${SPECIAL_FOLDER}/${VERSION_FOLDER_NAME}/**`, headFilesVersioned)
  router.get(`hyper://*/${SPECIAL_FOLDER}/${VERSION_FOLDER_NAME}/**`, getFilesVersioned)
  router.get('hyper://*/**', getFiles)
  router.head('hyper://*/**', headFiles)

  /**
   *
   * @param {Error} e
   * @returns {Promise<import('make-fetch').ResponseLike>}
   */
  async function onError (e) {
    return {
      // @ts-ignore
      status: e.statusCode || 500,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8'
      },
      body: e.stack
    }
  }

  /**
   *
   * @param {Hypercore} core
   * @param {string} name
   * @returns
   */
  async function getExtension (core, name) {
    const key = core.url + name
    if (extensions.has(key)) {
      return extensions.get(key)
    }
    const existing = core.extensions.get(name)
    if (existing) {
      extensions.set(key, existing)
      return existing
    }

    const extension = core.registerExtension(name, {
      encoding: 'utf-8',
      onmessage: (content, peer) => {
        core.emit(EXTENSION_EVENT, name, content, peer)
      }
    })

    extensions.set(key, extension)

    return extension
  }

  /**
   * @param {Hypercore} core
   * @param {string} name
   * @returns
   */
  async function getExtensionPeers (core, name) {
    // List peers with this extension
    const allPeers = core.peers
    return allPeers.filter((peer) => {
      return peer?.extensions?.has(name)
    })
  }

  /**
   * @param {Hypercore} core
   * @returns
   */
  function listExtensionNames (core) {
    return [...core.extensions.keys()]
  }

  /**
   * @param {Request} request
   * @returns
   */
  async function listExtensions (request) {
    const { hostname } = new URL(request.url)
    const accept = request.headers.get('Accept') || ''

    const core = await sdk.get(`hyper://${hostname}/`)

    if (accept.includes('text/event-stream')) {
      const events = new EventIterator(({ push }) => {
        /**
         *
         * @param {string} name
         * @param {string} content
         * @param {import('hypercore').Peer} peer
         */
        function onMessage (name, content, peer) {
          const id = peer.remotePublicKey.toString('hex')
          // TODO: Fancy verification on the `name`?
          // Send each line of content separately on a `data` line
          const data = content.split('\n').map((line) => `data:${line}\n`).join('')

          push(`id:${id}\nevent:${name}\n${data}\n`)
        }

        /**
         * @param {import('hypercore').Peer} peer
         */
        function onPeerOpen (peer) {
          const id = peer.remotePublicKey.toString('hex')
          push(`id:${id}\nevent:${PEER_OPEN}\n\n`)
        }

        /**
         * @param {import('hypercore').Peer} peer
         */
        function onPeerRemove (peer) {
          // Whatever, probably an uninitialized peer
          if (!peer.remotePublicKey) return
          const id = peer.remotePublicKey.toString('hex')
          push(`id:${id}\nevent:${PEER_REMOVE}\n\n`)
        }
        core.on(EXTENSION_EVENT, onMessage)
        core.on(PEER_OPEN, onPeerOpen)
        core.on(PEER_REMOVE, onPeerRemove)
        return () => {
          core.removeListener(EXTENSION_EVENT, onMessage)
          core.removeListener(PEER_OPEN, onPeerOpen)
          core.removeListener(PEER_REMOVE, onPeerRemove)
        }
      })

      return {
        statusCode: 200,
        headers: {
          [HEADER_CONTENT_TYPE]: MIME_EVENT_STREAM
        },
        body: events
      }
    }

    const extensions = listExtensionNames(core)
    return {
      status: 200,
      headers: { [HEADER_CONTENT_TYPE]: MIME_APPLICATION_JSON },
      body: JSON.stringify(extensions, null, '\t')
    }
  }

  /**
   * @param {Request} request
   * @returns
   */
  async function listenExtension (request) {
    const { hostname, pathname: rawPathname } = new URL(request.url)
    const pathname = decodeURI(ensureLeadingSlash(rawPathname))
    const name = pathname.slice(`/${SPECIAL_FOLDER}/${EXTENSIONS_FOLDER_NAME}/`.length)

    const core = await sdk.get(`hyper://${hostname}/`)

    await getExtension(core, name)

    const peers = await getExtensionPeers(core, name)
    const finalPeers = formatPeers(peers)
    const body = JSON.stringify(finalPeers, null, '\t')

    return {
      status: 200,
      body,
      headers: {
        [HEADER_CONTENT_TYPE]: MIME_APPLICATION_JSON
      }
    }
  }

  /**
   * @param {Request} request
   * @returns
   */
  async function broadcastExtension (request) {
    const { hostname, pathname: rawPathname } = new URL(request.url)
    const pathname = decodeURI(ensureLeadingSlash(rawPathname))

    const name = pathname.slice(`/${SPECIAL_FOLDER}/${EXTENSIONS_FOLDER_NAME}/`.length)

    const core = await sdk.get(`hyper://${hostname}/`)

    const extension = await getExtension(core, name)
    const data = await request.text()
    extension.broadcast(data)

    return { status: 200 }
  }

  /**
   * @param {Request} request
   * @returns
   */
  async function extensionToPeer (request) {
    const { hostname, pathname: rawPathname } = new URL(request.url)
    const pathname = decodeURI(ensureLeadingSlash(rawPathname))

    const subFolder = pathname.slice(`/${SPECIAL_FOLDER}/${EXTENSIONS_FOLDER_NAME}/`.length)
    const [name, extensionPeer] = subFolder.split('/')

    const core = await sdk.get(`hyper://${hostname}/`)

    const extension = await getExtension(core, name)
    const peers = await getExtensionPeers(core, name)
    const peer = peers.find(({ remotePublicKey }) => remotePublicKey.toString('hex') === extensionPeer)
    if (!peer) {
      return {
        status: 404,
        headers: {
          [HEADER_CONTENT_TYPE]: MIME_TEXT_PLAIN
        },
        body: 'Peer Not Found'
      }
    }
    const data = await request.arrayBuffer()
    extension.send(data, peer)
    return { status: 200 }
  }

  /**
   * @param {Request} request
   * @returns
   */
  async function getKey (request) {
    const key = new URL(request.url).searchParams.get('key')
    if (!key) {
      return { status: 400, body: 'Must specify key parameter to resolve' }
    }

    try {
      const drive = await sdk.getDrive(key)
      onLoad(new URL('/', drive.url), drive.writable, key)

      return { body: drive.url }
    } catch (e) {
      const message = /** @type Error */(e).message
      if (message === ERROR_KEY_NOT_CREATED) {
        return {
          status: 400,
          body: message,
          headers: {
            [HEADER_CONTENT_TYPE]: MIME_TEXT_PLAIN
          }
        }
      } else throw e
    }
  }

  /**
   * @param {Request} request
   * @returns
   */
  async function createKey (request) {
    // TODO: Allow importing secret keys here
    // Maybe specify a seed to use for generating the blobs?
    // Else we'd need to specify the blobs keys and metadata keys

    const key = new URL(request.url).searchParams.get('key')
    if (!key) {
      return { status: 400, body: 'Must specify key parameter to resolve' }
    }

    const drive = await sdk.getDrive(key)
    onLoad(new URL('/', drive.url), drive.writable, key)

    return { body: drive.url }
  }

  /**
   * @param {Request} request
   * @returns
   */
  async function putFiles (request) {
    const { hostname, pathname: rawPathname } = new URL(request.url)
    const pathname = decodeURI(ensureLeadingSlash(rawPathname))
    const contentType = request.headers.get('Content-Type') || ''
    const lastModified = request.headers.get('Last-Modified')
    const mtime = lastModified ? Date.parse(lastModified) : Date.now()
    const isFormData = contentType.includes('multipart/form-data')

    const drive = await sdk.getDrive(`hyper://${hostname}/`)

    if (!drive.writable) {
      return { status: 403, body: `Cannot PUT file to read-only drive: ${drive.url}`, headers: { Location: request.url } }
    }

    onLoad(new URL('/', request.url), drive.writable)

    if (isFormData) {
      // It's a form! Get the files out and process them
      const formData = await request.formData()
      for (const [name, data] of formData) {
        if (name !== 'file') continue
        if (typeof data === 'string') continue
        const filePath = posix.join(pathname, data.name)
        await pipelinePromise(
          Readable.from(data.stream()),
          drive.createWriteStream(filePath, {
            metadata: {
              mtime
            }
          })
        )
      }
    } else {
      if (pathname.endsWith('/')) {
        return { status: 405, body: 'Cannot PUT file with trailing slash', headers: { Location: request.url } }
      } else {
        await pipelinePromise(
          Readable.from(request.body),
          drive.createWriteStream(pathname, {
            metadata: {
              mtime
            }
          })
        )
      }
    }

    const fullURL = new URL(pathname, drive.url).href

    const headers = {
      Location: request.url,
      ETag: `${drive.version}`,
      Link: `<${fullURL}>; rel="canonical"`,
      [HEADER_LAST_MODIFIED]: isFormData ? undefined : new Date(mtime).toUTCString()
    }

    return { status: 201, headers }
  }

  /**
   * @param {Request} request
   * @returns
   */
  function putFilesVersioned (request) {
    return {
      status: 405,
      body: 'Cannot PUT file to old version',
      headers: { Location: request.url }
    }
  }

  /**
   * @param {Request} request
   * @returns
   */
  async function deleteDrive (request) {
    const { hostname } = new URL(request.url)
    const drive = await sdk.getDrive(`hyper://${hostname}/`)
    onDelete(new URL('/', request.url))

    await drive.purge()

    return { status: 200 }
  }

  /**
   * @param {Request} request
   * @returns
   */
  async function deleteFiles (request) {
    const { hostname, pathname: rawPathname } = new URL(request.url)
    const pathname = decodeURI(ensureLeadingSlash(rawPathname))

    const drive = await sdk.getDrive(`hyper://${hostname}/`)
    if (!drive.writable) {
      return { status: 403, body: `Cannot DELETE file in read-only drive: ${drive.url}`, headers: { Location: request.url } }
    }

    onLoad(new URL('/', request.url), drive.writable)

    if (pathname.endsWith('/')) {
      let didDelete = false
      for await (const entry of drive.list(pathname)) {
        await drive.del(entry.key)
        didDelete = true
      }
      if (!didDelete) {
        return { status: 404, body: 'Not Found', headers: { [HEADER_CONTENT_TYPE]: MIME_TEXT_PLAIN } }
      }
      return { status: 200 }
    }

    const entry = await drive.entry(pathname)

    if (!entry) {
      return { status: 404, body: 'Not Found', headers: { [HEADER_CONTENT_TYPE]: MIME_TEXT_PLAIN } }
    }
    await drive.del(pathname)

    const fullURL = new URL(pathname, drive.url).href

    const headers = {
      ETag: `${drive.version}`,
      Link: `<${fullURL}>; rel="canonical"`
    }

    return { status: 200, headers }
  }

  /**
   * @param {Request} request
   * @returns
   */
  function deleteFilesVersioned (request) {
    return { status: 405, body: 'Cannot DELETE old version', headers: { Location: request.url } }
  }

  /**
   * @param {Request} request
   * @returns
   */
  async function headFilesVersioned (request) {
    const url = new URL(request.url)
    const { hostname, pathname: rawPathname, searchParams } = url
    const pathname = decodeURI(ensureLeadingSlash(rawPathname))

    const accept = request.headers.get('Accept') || ''
    const isRanged = request.headers.get('Range') || ''
    const noResolve = searchParams.has('noResolve')

    const parts = pathname.split('/')
    const version = parseInt(parts[3], 10)
    const realPath = ensureLeadingSlash(parts.slice(4).join('/'))

    const drive = await sdk.getDrive(`hyper://${hostname}/`)

    if (!drive.writable && !drive.core.length) {
      return {
        status: 404,
        body: 'Peers Not Found'
      }
    }

    const snapshot = await drive.checkout(version)

    return serveHead(snapshot, realPath, { accept, isRanged, noResolve })
  }

  /**
   * @param {Request} request
   * @returns
   */
  async function headFiles (request) {
    const url = new URL(request.url)
    const { hostname, pathname: rawPathname, searchParams } = url
    const pathname = decodeURI(ensureLeadingSlash(rawPathname))

    const accept = request.headers.get('Accept') || ''
    const isRanged = request.headers.get('Range') || ''
    const noResolve = searchParams.has('noResolve')

    const drive = await sdk.getDrive(`hyper://${hostname}/`)

    if (!drive.writable && !drive.core.length) {
      return {
        status: 404,
        body: 'Peers Not Found'
      }
    }

    return serveHead(drive, pathname, { accept, isRanged, noResolve })
  }

  /**
   *
   * @param {Hyperdrive} drive
   * @param {*} pathname
   * @param {object} options
   * @param {string} options.accept
   * @param {string} options.isRanged
   * @param {boolean} options.noResolve
   * @returns
   */
  async function serveHead (drive, pathname, { accept, isRanged, noResolve }) {
    const isDirectory = pathname.endsWith('/')
    const fullURL = new URL(pathname, drive.url).href

    const isWritable = writable && drive.writable

    const Allow = isWritable ? BASIC_METHODS.concat(WRITABLE_METHODS) : BASIC_METHODS

    /** @type {{[key: string]: string}} */
    const resHeaders = {
      ETag: `${drive.version}`,
      'Accept-Ranges': 'bytes',
      Link: `<${fullURL}>; rel="canonical"`,
      Allow: Allow.toString()
    }

    if (isDirectory) {
      const entries = await listEntries(drive, pathname)

      const hasItems = entries.length

      if (!hasItems && pathname !== '/') {
        return {
          status: 404,
          headers: {
            [HEADER_CONTENT_TYPE]: MIME_TEXT_PLAIN
          }
        }
      }

      if (!noResolve) {
        for (const indexFile of INDEX_FILES) {
          if (entries.includes(indexFile)) {
            const mimeType = getMimeType(indexFile)
            return {
              status: 204,
              headers: {
                ...resHeaders,
                [HEADER_CONTENT_TYPE]: mimeType
              }
            }
          }
        }
      }

      // TODO: Add range header calculation
      if (accept.includes('text/html')) {
        return {
          status: 204,
          headers: {
            ...resHeaders,
            [HEADER_CONTENT_TYPE]: MIME_TEXT_HTML
          }
        }
      }

      return {
        status: 204,
        headers: {
          ...resHeaders,
          [HEADER_CONTENT_TYPE]: MIME_APPLICATION_JSON
        }
      }
    }

    const { entry, path } = await resolvePath(drive, pathname, noResolve)

    if (!entry) {
      return { status: 404, body: 'Not Found' }
    }

    resHeaders.ETag = `${entry.seq + 1}`
    resHeaders['Content-Length'] = `${entry.value.blob.byteLength}`

    const contentType = getMimeType(path)
    resHeaders[HEADER_CONTENT_TYPE] = contentType

    if (entry?.value?.metadata?.mtime) {
      const date = new Date(entry.value.metadata.mtime)
      resHeaders[HEADER_LAST_MODIFIED] = date.toUTCString()
    }

    const size = entry.value.blob.byteLength
    if (isRanged) {
      const ranges = parseRange(size, isRanged)
      const isRangeValid = ranges !== -1 && ranges !== -2 && ranges

      if (isRangeValid && ranges.length && ranges.type === 'bytes') {
        const [{ start, end }] = ranges
        const length = (end - start + 1)

        return {
          status: 204,
          headers: {
            ...resHeaders,
            'Content-Length': `${length}`,
            'Content-Range': `bytes ${start}-${end}/${size}`
          }
        }
      }
    }

    return {
      status: 204,
      headers: resHeaders
    }
  }

  /**
   * @param {Request} request
   * @returns
   */
  async function getFilesVersioned (request) {
    const url = new URL(request.url)
    const { hostname, pathname: rawPathname, searchParams } = url
    const pathname = decodeURI(ensureLeadingSlash(rawPathname))

    const accept = request.headers.get('Accept') || ''
    const isRanged = request.headers.get('Range') || ''
    const noResolve = searchParams.has('noResolve')

    const parts = pathname.split('/')
    const version = parseInt(parts[3], 10)
    const realPath = ensureLeadingSlash(parts.slice(4).join('/'))

    const drive = await sdk.getDrive(`hyper://${hostname}/`)

    if (!drive.writable && !drive.core.length) {
      return {
        status: 404,
        body: 'Peers Not Found'
      }
    }

    onLoad(new URL('/', request.url), drive.writable)

    const snapshot = await drive.checkout(version)

    return serveGet(snapshot, realPath, { accept, isRanged, noResolve })
  }

  /**
 * @param {Request} request
 * @returns
 */
  async function getFiles (request) {
    // TODO: Redirect on directories without trailing slash
    const url = new URL(request.url)
    const { hostname, pathname: rawPathname, searchParams } = url
    const pathname = decodeURI(ensureLeadingSlash(rawPathname))

    const accept = request.headers.get('Accept') || ''
    const isRanged = request.headers.get('Range') || ''
    const noResolve = searchParams.has('noResolve')

    const drive = await sdk.getDrive(`hyper://${hostname}/`)

    if (!drive.writable && !drive.core.length) {
      return {
        status: 404,
        body: 'Peers Not Found'
      }
    }

    onLoad(new URL('/', request.url), drive.writable)

    return serveGet(drive, pathname, { accept, isRanged, noResolve })
  }

  /**
   * @param {Hyperdrive} drive
   * @param {string} pathname
   * @param {object} options
   * @param {string} options.accept
   * @param {string} options.isRanged
   * @param {boolean} options.noResolve
   * @returns
   */
  async function serveGet (drive, pathname, { accept, isRanged, noResolve }) {
    const isDirectory = pathname.endsWith('/')
    const fullURL = new URL(pathname, drive.url).href

    if (isDirectory) {
      const resHeaders = {
        ETag: `${drive.version}`,
        Link: `<${fullURL}>; rel="canonical"`
      }

      const entries = await listEntries(drive, pathname)

      if (!entries.length && pathname !== '/') {
        return {
          status: 404,
          body: '[]',
          headers: {
            ...resHeaders,
            [HEADER_CONTENT_TYPE]: MIME_APPLICATION_JSON
          }
        }
      }

      if (!noResolve) {
        for (const indexFile of INDEX_FILES) {
          if (entries.includes(indexFile)) {
            return serveFile(drive, posix.join(pathname, indexFile), isRanged)
          }
        }
      }

      if (accept.includes('text/html')) {
        const body = await renderIndex(new URL(fullURL), entries, fetch)
        return {
          status: 200,
          body,
          headers: {
            ...resHeaders,
            [HEADER_CONTENT_TYPE]: MIME_TEXT_HTML
          }
        }
      }

      return {
        status: 200,
        body: JSON.stringify(entries, null, '\t'),
        headers: {
          ...resHeaders,
          [HEADER_CONTENT_TYPE]: MIME_APPLICATION_JSON
        }
      }
    }

    const { entry, path } = await resolvePath(drive, pathname, noResolve)

    if (!entry) {
      return { status: 404, body: 'Not Found' }
    }

    return serveFile(drive, path, isRanged)
  }

  return fetch
}

/**
 *
 * @param {Hyperdrive} drive
 * @param {string} pathname
 * @param {string} [isRanged]
 * @returns
 */
async function serveFile (drive, pathname, isRanged) {
  const contentType = getMimeType(pathname)

  const fullURL = new URL(pathname, drive.url).href

  const entry = await drive.entry(pathname)

  /** @type {{[key: string]: string}} */
  const resHeaders = {
    ETag: `${entry.seq + 1}`,
    [HEADER_CONTENT_TYPE]: contentType,
    'Accept-Ranges': 'bytes',
    Link: `<${fullURL}>; rel="canonical"`
  }

  if (entry?.value?.metadata?.mtime) {
    const date = new Date(entry.value.metadata.mtime)
    resHeaders[HEADER_LAST_MODIFIED] = date.toUTCString()
  }

  const size = entry.value.blob.byteLength
  if (isRanged) {
    const ranges = parseRange(size, isRanged)
    const isRangeValid = ranges !== -1 && ranges !== -2 && ranges

    if (isRangeValid && ranges.length && ranges.type === 'bytes') {
      const [{ start, end }] = ranges
      const length = (end - start + 1)

      return {
        status: 200,
        body: drive.createReadStream(pathname, {
          start,
          end
        }),
        headers: {
          ...resHeaders,
          'Content-Length': `${length}`,
          'Content-Range': `bytes ${start}-${end}/${size}`
        }
      }
    }
  }
  return {
    status: 200,
    headers: {
      ...resHeaders,
      'Content-Length': `${size}`
    },
    body: drive.createReadStream(pathname)
  }
}

/**
 * @param {string} pathname
 * @returns {string[]}
 */
function makeToTry (pathname) {
  return [
    pathname,
    pathname + '.html',
    pathname + '.md'
  ]
}

/**
 * @param {Hyperdrive} drive
 * @param {string} pathname
 * @param {boolean} noResolve
 * @returns
 */
async function resolvePath (drive, pathname, noResolve) {
  if (noResolve) {
    const entry = await drive.entry(pathname)

    return { entry, path: pathname }
  }

  for (const path of makeToTry(pathname)) {
    const entry = await drive.entry(path)
    if (entry) {
      return { entry, path }
    }
  }

  return { entry: null, path: null }
}

/**
 *
 * @param {Hyperdrive} drive
 * @param {string} [pathname]
 * @returns
 */
async function listEntries (drive, pathname = '/') {
  const entries = []
  for await (const path of drive.readdir(pathname)) {
    const fullPath = posix.join(pathname, path)
    const stat = await drive.entry(fullPath)
    if (stat === null) {
      entries.push(path + '/')
    } else {
      entries.push(path)
    }
  }
  return entries
}

/**
 *
 * @param {import('hypercore').Peer[]} peers
 * @returns
 */
function formatPeers (peers) {
  return peers.map((peer) => {
    const remotePublicKey = peer.remotePublicKey.toString('hex')
    // @ts-ignore
    const remoteHost = peer.stream?.rawStream?.remoteHost
    return {
      remotePublicKey,
      remoteHost
    }
  })
}

/**
 *
 * @param {string} path
 * @returns {string}
 */
function getMimeType (path) {
  let mimeType = mime.getType(path) || 'text/plain; charset=utf-8'
  if (mimeType.startsWith('text/')) mimeType = `${mimeType}; charset=utf-8`
  return mimeType
}

/**
 *
 * @param {string} path
 * @returns {string}
 */
function ensureLeadingSlash (path) {
  return path.startsWith('/') ? path : '/' + path
}
