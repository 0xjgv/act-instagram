// Crawl links.
const Apify = require('apify');
const puppeteer = require('puppeteer');
const { typeCheck } = require('type-check');
const requestPromise = require('request-promise');

const { log, dir } = console;

const INPUT_TYPE = `{
  actId: String,
  token: String,
  postCSSSelector: String,
  extractActInput: Object
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
  let uri = null;
  const input = await Apify.getValue('INPUT');
  if (!typeCheck(INPUT_TYPE, input)) {
    log('Expected input:');
    log(INPUT_TYPE);
    log('Received input:');
    dir(input);
    throw new Error('Received invalid input');
  }
  const { actId, token, postCSSSelector } = input;
  const waitForFinish = 'waitForFinish=60';
  uri = `https://api.apify.com/v2/acts/${actId}/runs?token=${token}&${waitForFinish}`;
  log(actId, uri, postCSSSelector);

  const options = {
    uri,
    method: 'POST',
    'content-type': 'application/json',
    body: input.extractActInput,
    json: true,
  };
  // Get act, run it and crawl result links
  // https://www.apify.com/docs/api-v2#/reference/acts/runs-collection/run-act
  const { data } = await requestPromise(options);
  log(data);

  const storeId = data.defaultKeyValueStoreId;
  const recordKey = 'ALL_LINKS';
  log(storeId);
  uri = `https://api.apify.com/v2/key-value-stores/${storeId}/records/${recordKey}`;

  log(uri);
  const userObjects = await requestPromise(uri);
  log(userObjects);

  log('Openning browser...');
  const browser = await puppeteer.launch({
    args: ['--no-sandbox'],
    headless: !!process.env.APIFY_HEADLESS,
  });
  log('New browser window.');

  // TODO: Get the state of crawling (the act might have been restarted)
  // state = await Apify.getValue('STATE') || DEFAULT_STATE
  log('Closing browser.');
  await browser.close();
});
