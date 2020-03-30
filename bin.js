#!/usr/bin/env node

run()
	.catch((e) => process.nextTick(() => {
		throw e
	}))

async function run() {
	const fetch = require('./')()

	try {
		const url = process.argv[2]

		const response = await fetch(url)

		const text = await response.text()

		console.log(text)
	} finally {
		fetch.close()
	}
}
