const storage = require('random-access-memory')
const SDK = require('dat-sdk')

async function test () {
	const {Hyperdrive, resolveName, close } = await SDK({
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

  await close()
}

test().then(() => {
  process.exit(0)
}, (e) => {
  process.nextTick(() => {
    throw e
  })
})
