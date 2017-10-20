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

async function crawlUrl(browser, username, url, cssSelector = 'article') {
  let page = null;
  let crawlResult = {};
  try {
    page = await browser.newPage();
    log(`New browser page for: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector(cssSelector);
    // Crawl page
    const articleHandle = await page.$(cssSelector);
    crawlResult = await page.evaluate((article) => {
      const handle = article.querySelector('[title]').title;
      let postText = [...article.querySelectorAll(`[title="${handle}"]`)];
      postText = postText[1] ? postText[1].nextElementSibling.textContent : '';
      const time = article.querySelector('time').getAttribute('datetime');
      return {
        handle,
        url: document.URL,
        'post-text': postText || 'No text post',
        'date/time': time,
      };
    }, articleHandle);
    log('CRAWL RESULT: ', crawlResult);
  } catch (error) {
    throw new Error(`The page ${url}, could not be loaded: ${error}`);
  } finally {
    if (page) {
      await page.close().catch(error => log(`Error closing page: (${url}): ${error}.`));
    }
  }
  return crawlResult;
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
  const {
    actId,
    token,
    postCSSSelector,
    extractActInput,
  } = input;
  log(extractActInput);

  const waitForFinish = 'waitForFinish=60';
  uri = `https://api.apify.com/v2/acts/${actId}/runs?token=${token}&${waitForFinish}`;
  log('REQUESTING ACT-EXTRACT: ', uri);

  let options = {
    uri,
    method: 'POST',
    'content-type': 'application/json',
    body: extractActInput,
    json: true,
  };
  const { data } = await requestPromise(options);
  log('ACT-EXTRACT Run result: ', data);

  const storeId = data.defaultKeyValueStoreId;
  const recordKey = 'ALL_LINKS';
  log('ACT-EXTRACT Store ID: ', storeId);
  uri = `https://api.apify.com/v2/key-value-stores/${storeId}/records/${recordKey}`;
  log(uri);

  options = {
    uri,
    method: 'GET',
    gzip: true,
    'content-type': 'application/json',
    json: true,
  };
  const arrayOfUsers = await requestPromise(options);

  log('Openning browser...');
  const browser = await puppeteer.launch({
    args: ['--no-sandbox'],
    headless: !!process.env.APIFY_HEADLESS,
  });
  log('New browser window.');

  const crawlData = arrayOfUsers.map(({ username, postsLinks }) => (
    postsLinks.reduce((prev, url) => (
      prev.then(() => crawlUrl(browser, username, url, postCSSSelector))
    ), Promise.resolve())
  ));

  let results;
  try {
    results = await Promise.all(crawlData);
  } catch (error) {
    console.log('ERROR: ', error);
  }
  log('results', results);

  // TODO: Get the state of crawling (the act might have been restarted)
  // state = await Apify.getValue('STATE') || DEFAULT_STATE
  log('Closing browser.');
  await browser.close();
});
