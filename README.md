# dat-fetch

Implementation of Fetch that uses the Dat SDK for loading p2p content

`npm install --save dat-fetch`

```javascript
const fetch = require('dat-fetch')()

const someURL = `hyper://blog.mauve.moe`

const response = await fetch(`${someURL}/index.json`)

const json = await response.json()

console.log(json)
```

You can also use the bundled CLI

```
npm i -g dat-fetch

dat-fetch dat://somethingorother

# Or

npx dat-fetch dat://somethingorother
```

## API

### `makeFetch({Hyperdrive, resolveName, base, session, writable}) => fetch()`

Creates a dat-fetch instance.

The `base` parameter can be used to specify what the base URL is for relative paths like `fetch('./dat.json')`.

You can pass in options for the [Dat SDK](https://github.com/datproject/sdk) to have it be auto-created,
or you can pass in both a function matching  `const archive = Hyperdrive(key)` and a `const resolved = await resolveName(url)` function.

Set `session` to your Electron session if you want to enable setting the `body` of fetch requests to Electron's [UploadData](https://www.electronjs.org/docs/api/structures/upload-data) API in their protocol handlers.

If you don't want to allow write access to archives, pass in `writable: false`.

Typically, you don't need to pass in any of these and they're there for more advanced users.

After you've created it, `fetch` will be have like it does in [browsers](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API).

### `await fetch.close()`

Closes resources for the Dat SDK. This does nothing if you specified the Hyperdrive and `resolveName` options.

### `fetch('hyper://NAME/example.txt', {method: 'GET'})`

This will attempt to load `example.txt` from the archive labeled by `NAME`.

It will also load `index.html` files automatically for a folder.
You can find the details about how resolution works in the [resolve-dat-path](https://github.com/RangerMauve/resolve-dat-path/blob/master/index.js#L3) module.

`NAME` can either be the 64 character hex key for an archive, a domain to parse with [dat-dns](https://www.npmjs.com/package/dat-dns), or a name for an archive which allows you to write to it.

### `fetch('hyper://NAME/index.json', {method: 'GET'})`

The `index.json` file is special in that it will be modified to contain some extra parameters in the JSON content.

This extends from the [Index.json Manifest](https://docs.beakerbrowser.com/developers/index.json-manifest) spec in Beaker.

`url` will get set to the `hyper://` URL of the archive. This will resolve the `NAME` to always be the 64 character hex key.

### `fetch('hyper://NAME/example/', {method: 'GET'})`

When doing a `GET` on a directory, you will get a directory listing.

By default it will render out an HTML page with links to files within that directory.

You can set the `Accept` header to `application/json` in order to have it return a JSON array with file names.

`NAME` can either be the 64 character hex key for an archive, a domain to parse with [dat-dns](https://www.npmjs.com/package/dat-dns), or a name for an archive which allows you to write to it.

### `fetch('hyper://NAME/example.txt', {method: 'PUT', body: 'Hello World'})`

You can add files to archives using a `PUT` method along with a `body`.

The `body` can be either a `String`, an `ArrayBuffer`, a `Blob`, a WHATWG `ReadableStream`, a Node.js `Stream`, or electron's [UploadData](https://www.electronjs.org/docs/api/structures/upload-data) object (make sure to specify the `session` argument in the `makeFetch` function for electron support).

`NAME` can either be the 64 character hex key for an archive, a domain to parse with [dat-dns](https://www.npmjs.com/package/dat-dns), or a name for an archive which allows you to write to it.

Your `NAME` will likely be a `name` in most cases to ensure you have a writeable archive.

### `fetch('hyper://NAME/example.txt', {method: 'DELETE'})`

You can delete a file in an archive by using the `DELETE` method.

You cannot delete directories if they are not empty.

`NAME` can either be the 64 character hex key for an archive, a domain to parse with [dat-dns](https://www.npmjs.com/package/dat-dns), or a name for an archive which allows you to write to it.
