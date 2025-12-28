# hypercore-fetch

Implementation of Fetch that uses the Hyper SDK for loading p2p content

`npm install --save hypercore-fetch`

```javascript
import makeHyperFetch from 'hypercore-fetch'
import * as SDK from 'hyper-sdk'

// Create in-memory hyper-sdk instance
const sdk = await SDK.create({storage: false})

const fetch = await makeFetch({
  sdk: true,
  writable: true
})

const someURL = `hyper://blog.mauve.moe/`

const response = await fetch(someURL)

const data = await response.text()

console.log(data)
```

## API

### `makeHyperFetch({sdk, writable=false, extensionMessages = writable, renderIndex, onLoad, onDelete}) => fetch()`

Creates a hypercore-fetch instance.

The `sdk` argument should be an instance of [hyper-sdk](https://github.com/RangerMauve/hyper-sdk).

The `writable` flag toggles whether the `PUT`/`POST`/`DELETE` methods are available.

`extensionMessages` enables/disables Hypercore Extension Message support which is used for sending extra data to peers on top of hypercore replication streams.

`renderIndex` is an optional function to override the HTML index rendering functionality. By default it will make a simple page which renders links to files and folders within the directory.
This function takes the `url`, `files` array and `fetch` instance as arguments.

`onLoad` is an optional function that gets called whenever a site is loaded. It gets these arguments passed in: `(url: URL, writable: boolean, key?: string)`. The `key` gets specified on creation based on the name a user assigned it. Use this to track created drives and last access times (e.g. for clearing out old drives).

`onDelete` is an optional function that gets called whenever a drive is purged from storage. Similar to `onLoad`, it gets called with a `URL` of the deleted site.

After you've created it, `fetch` will behave like it does in [browsers](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API).

### Common Headers

Each response will contain a header for the canonical URL represented as a `Link` header with `rel=canonical`.

There is also an `ETag` header which will be a JSON string containging the drive's current `version`, or the file's sequence number.
This will change only when the drive has gotten an update of some sort and is monotonically incrementing.
The `ETag` representing a file's sequence number represents the version the Hyperdrive was at when the file was added.
Thus you can get the previous version of a file by using `hyper://NAME/$/version/${ETAG}/example.txt`.

If the resource is a file, it may contain the `Last-Modified` header if the file has had a `metadata.mtime` flag set upon update.

If the resource is a directory, it will contain the `Allow` header to
indicate whether a hyperdrive is writable (`'HEAD,GET'`) or not
(`'HEAD,GET,PUT,DELETE'`).

### `fetch('hyper://NAME/example.txt', {method: 'GET'})`

This will attempt to load `example.txt` from the archive labeled by `NAME`.

It will also load `index.html` files automatically for a folder.
You can find the details about how resolution works in the [resolve-dat-path](https://github.com/RangerMauve/resolve-dat-path/blob/master/index.js#L3) module.

`NAME` can either be the 52 character [z32 encoded](https://github.com/mafintosh/z32) key for a Hyperdrive or Hypercore , or a domain to parse with the [DNSLink](https://www.dnslink.io/) standard.

### `fetch('hyper://NAME/example/', {method: 'GET'})`

When doing a `GET` on a directory, you will get a directory listing.

By default it will return a JSON array of files and folders in that directory.

You can differentiate a folder from files by the fact that it ends with a `/`.

You can set the `Accept` header to `text/html` in order to have it return a basic HTML page with links to files and folders in that directory.
This can be overrided with the `renderIndex` option if you want custom index pages.

e.g.

```json
["example.txt", "posts/", "example2.md"]
```

Files in the directory will be listed under their name, sub-directories will have a `/` appended to them.

`NAME` can either be the 52 character [z32 encoded](https://github.com/mafintosh/z32) key for a Hyperdrive or Hypercore , or a domain to parse with the [DNSLink](https://www.dnslink.io/) standard.

### `fetch('hyper://NAME/example/?noResolve', {method: 'GET'})`

Adding `?noResolve` to a URL will prevent resolving `index.html` files and will attempt to load the path as is.
This can be useful for list files in a directory that would normally render as a page.

`NAME` can either be the 52 character [z32 encoded](https://github.com/mafintosh/z32) key for a Hyperdrive or Hypercore , or a domain to parse with the [DNSLink](https://www.dnslink.io/) standard.

### `fetch('hyper://localhost/?key=NAME', {method: 'POST'})`

In order to create a writable Hyperdrive with its own URL, you must first generate a keypair for it.

`NAME` can be any alphanumeric string which can be used for key generation in [Corestore](https://github.com/holepunchto/corestore).

The response body will contain a `hyper://` URL with the new Hyperdrive.

You can then use this with `PUT`/`DELETE` requests.

Note that this is only available with the `writable: true` flag.

### `fetch('hyper://localhost/?key=NAME', {method: 'GET'})`

If you want to resolve the public key URL of a previously created Hyperdrive, you can do this with the `GET` method on the key creation URL.

`NAME` can be any alphanumeric string which can be used for key generation in [Corestore](https://github.com/holepunchto/corestore).

The response body will contain a `hyper://` URL with the new Hyperdrive.

You can then use this with `PUT`/`DELETE` requests.

Note that this is only available with the `writable: true` flag.

### `fetch('hyper://NAME/example.txt', {method: 'PUT', body: 'Hello World'})`

You can add files to archives using a `PUT` method along with a
`body`. Note that this is only available with the `writable: true`
flag.

The `body` can be any of the options supported by the Fetch API such as a `String`, `Blob`, `FormData`, or `ReadableStream`.

`NAME` can either be the 52 character [z32 encoded](https://github.com/mafintosh/z32) key for a Hyperdrive or Hypercore , or a domain to parse with the [DNSLink](https://www.dnslink.io/) standard.

The mtime metadata is automatically set to the current time when
uploading. To override this value, pass a `Last-Modified` header with a value
set to a date string according to [RFC
7231](https://datatracker.ietf.org/doc/html/rfc7231#section-7.1.1.1).

An attempt to `PUT` a file to a hyperdrive which is not writable will
fail with status `403`.

### `fetch('hyper://NAME/folder/', {method: 'PUT', body: new FormData()})`

You can add multiple files to a folder using the `PUT` method with a [FormData](https://developer.mozilla.org/en-US/docs/Web/API/FormData) body.

You can [append](https://developer.mozilla.org/en-US/docs/Web/API/FormData) to a FormData with `formData.append('file', content, 'filename.txt')` where `fieldname` gets ignored (use something like `file`?) the `content` can either be a String, Blob, or some sort of stream.
The `filename` will be the filename within the directory that gets created.

Note that you must use the name `file` for uploaded files.

`NAME` can either be the 52 character [z32 encoded](https://github.com/mafintosh/z32) key for a Hyperdrive or Hypercore , or a domain to parse with the [DNSLink](https://www.dnslink.io/) standard.

### `fetch('hyper://NAME/', {method: 'DELETE'})`

You can purge all the stored data for a hyperdrive by sending a `DELETE` to it's root.

If this is a writable drive, your data will get fully clearned and trying to write to it again will lead to data corruption.

If you try to load this drive again data will be loaded from scratch.

`NAME` can either be the 52 character [z32 encoded](https://github.com/mafintosh/z32) key for a Hyperdrive or Hypercore , or a domain to parse with the [DNSLink](https://www.dnslink.io/) standard.

### `fetch('hyper://NAME/example.txt', {method: 'DELETE'})`

You can delete a file or directory tree in a Hyperdrive by using the `DELETE` method.

`NAME` can either be the 52 character [z32 encoded](https://github.com/mafintosh/z32) key for a Hyperdrive or Hypercore , or a domain to parse with the [DNSLink](https://www.dnslink.io/) standard.

Note that this is only available with the `writable: true` flag.

An attempt to `DELETE` a file in a hyperdrive which is not writable
will fail with status `403`.

### `fetch('hyper://NAME/$/extensions/')`

You can list the current [hypercore extensions](https://github.com/hypercore-protocol/hypercore#ext--feedregisterextensionname-handlers) that are enabled by doing a `GET` on the `/$/extensions/` directory.

This will give you a directory listing with the names of all the extensions.

Note that this requires the `extensionMessages: true` flag.

### `fetch('hyper://NAME/$/extensions/EXTENSION_NAME')`

You can list the peers that you are replication with which have registered this extension by doing a `GET` to the directory for the extension.

This is also how you can register an extension that hasn't been registered yet.

The list will be a JSON array with objects that contain the fields `remotePublicKey` and `remoteHost`.

Note that this requires the `extensionMessages: true` flag.

### `fetch('hyper://NAME/$/extensions/', {headers: {'Accept': 'text/event-stream'}})`

Using the `text/event-stream` content type in the `Accept` header will get back an event stream with the extension events.

You can get the browser's [EventSource API](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) over hypercore-fetch by using the [@rangermauve/fetch-to-eventsource](https://github.com/RangerMauve/fetch-event-source) module.

The `event` will be the name of the extension you got the data for, the `id` (accessible by `e.lastEventId` in EventSource) will be set to the ID of the peer that sent it.

Only extension messages that have been queried before via a `GET` to the EXTENSION_NAME will be visible in this stream.

There are also two special events: `peer-open` which gets emitted whena new peer has connected, and `peer-remove` which gets emitted when an existing peer disconnects.

Note that this requires the `extensionMessages: true` flag.

### `fetch('hyper://NAME/$/extensions/EXTENSION_NAME', {method: 'POST', body: 'Example'})`

You can broadcast an extension message to all peers that are replicating that extension type with a `POST` to the extension's URL.

The `body` of the request will be used as the payload.
Please note that only utf8 encoded text is currently supported due to limitations of the event-stream encoding.

Note that this requires the `extensionMessages: true` flag.

### `fetch('hyper://NAME/$/extensions/EXTENSION_NAME/REMOTE_PUBLIC_KEY', {method: 'POST', body: 'Example'})`

You can send an extension message to a specific peer by doing a `POST` to the extension with their remote public key ID.

The `body` of the request will be used as the payload.
Please note that only utf8 encoded text is currently supported due to limitations of the event-stream encoding.

Note that this requires the `extensionMessages: true` flag.

### `fetch('hyper://NAME/$/version/VERSION_NUMBER/example.txt')`

You can get older views of data in an archive by using the special `/$/version` folder with a version number to view older states.

`VERSION_NUMBER` should be a number representing the version to check out based on the `ETag` of the root of the archive.

From there, you can use `GET` and `HEAD` requests with allt he same headers and querystring paramters as non-versioned paths to data.

Note that you cannot `PUT` or `DELETE` data in a versioned folder.


## Limitations:

- Since we make use of the special directory `$`, you cannot store files in this folder. If this is a major blocker, feel free to open an issue with alternative folder names we should consider.
