// Crawl links.
const Apify = require('apify');
const puppeteer = require('puppeteer');
const request = require('request-promise');
const { typeCheck } = require('type-check');

const { log, dir } = console;

const INPUT_TYPE = `{
  actId: String,
  postCSSSelector: String,
}`;

async function extractUrls(browser, username, url, cssSelector) {
  let page = null;
  const result = {};
  try {
    page = await browser.newPage();
    log(`New browser page for: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector(cssSelector);

    // Crawl page
    const postsUrls = await page.evaluate((selector) => {
      const anchors = Array.from(document.querySelectorAll(selector));
      return anchors.map(anchor => anchor.firstElementChild.getAttribute('href'));
    }, cssSelector);
    // Format the result and add return it
  } catch (error) {
    throw new Error(`The page ${url}, could not be loaded: ${error}`);
  } finally {
    if (page) {
      await page.close().catch(error => log(`Error closing page: (${url}): ${error}.`));
    }
  }
  return result;
}

Apify.main(async () => {
  const input = await Apify.getValue('INPUT');
  if (!typeCheck(INPUT_TYPE, input)) {
    log('Expected input:');
    log(INPUT_TYPE);
    log('Received input:');
    dir(input);
    throw new Error('Received invalid input');
  }
  const { actId, postCSSSelector } = input;
  // Get act, run it and crawl result links
  // https://www.apify.com/docs/api-v2#/reference/acts/runs-collection/run-act
  const data = request('https://api.apify.com/v2/acts/juansgaitan~instagram-extract/runs?token=WS5tRSq9pmnMMCEpsJEvZHhTg');

  log('Openning browser...');
  const browser = await puppeteer.launch({
    args: ['--no-sandbox'],
    headless: !!process.env.APIFY_HEADLESS,
  });
  log('New browser window.');

  parseUrl = parseUrlFor(baseUrl);
  const allExtractedUrls = usernames.map((username) => {
    const { href } = parseUrl(username);
    return extractUrls(browser, username, href, postCSSSelector);
  });
  const urls = await Promise.all(allExtractedUrls);
  await Apify.setValue('ALL_LINKS', urls);
  log(urls);

  // TODO: Get the state of crawling (the act might have been restarted)
  // state = await Apify.getValue('STATE') || DEFAULT_STATE
  log('Closing browser.');
  await browser.close();
});
