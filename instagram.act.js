const { URL } = require('url')
const Apify = require('apify')
const puppeteer = require('puppeteer')
const typeCheck = require('type-check').typeCheck
const log = console.log

// Definition of the input
const INPUT_TYPE = `{
  baseUrl: Maybe String,
  usernames: Maybe [String],
}`

const parseUrlFor = (baseUrl) => (input) => new URL(input, baseUrl)

async function extractPostInfoFrom (page) {
  const evalData = await page.evaluate(() => {
    return {
      currentUrl: location.href,
      html: document.documentElement.innerHTML,
      scriptCount: document.querySelectorAll('script').length,
      allWindowProperties: Object.keys(window)
    }
  })
  log('Eval data:')
  log(evalData)
  return evalData
}

async function workerFunc (browser, url, baseUrl) {
  try {
    const page = await browser.newPage()

    log('New browser page for: ' + url)
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForSelector('._mck9w._gvoze._f2mse')

    const postsUrls = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('._mck9w._gvoze._f2mse'))
      return anchors.map(anchor =>
        anchor.firstElementChild.getAttribute('href')
      )
    })
    log(postsUrls)

    const addBaseUrl = parseUrlFor(baseUrl)
    postsUrls.forEach(async (postUrl) => {
      let parsedUrl = addBaseUrl(postUrl)
      await page.goto(parsedUrl.href, { waitUntil: 'networkidle' })
      await page.waitForSelector('._hm7pe')
      await extractPostInfoFrom(page)
    })

    await page.close()
  } catch (error) {
    throw new Error(`The page ${url}, could not be loaded: ${error}`)
  } finally {
    log('Finished')
  }
}
const pages = []

Apify.main(async () => {
  // Fetch and check the input
  const input = await Apify.getValue('INPUT')
  if (!typeCheck(INPUT_TYPE, input)) {
    log('Expected input:')
    log(INPUT_TYPE)
    log('Received input:')
    console.dir(input)
    throw new Error('Received invalid input')
  }

  const parseUrl = parseUrlFor(input.baseUrl)
  const usersUrls = [].concat(input.usernames.map(parseUrl))

  log('Openning browser...')
  const browser = await puppeteer.launch({
    args: ['--no-sandbox'],
    headless: !!process.env.APIFY_HEADLESS
  })
  log('New browser window')
  await workerFunc(browser, usersUrls[0].href, input.baseUrl)

  // Get the state of crawling (the act might have been restarted)
  // state = await Apify.getValue('STATE') || DEFAULT_STATE
  await browser.close()
})
