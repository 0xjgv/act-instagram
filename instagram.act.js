const { URL } = require('url');
const Apify = require('apify');
const puppeteer = require('puppeteer');
const { typeCheck } = require('type-check');

const { log } = console;

const INPUT_TYPE = `{
  baseUrl: String,
  postsCSSSelectors: String,
  usernames: [String],
}`;

const parseUrlFor = baseUrl => input => new URL(input, baseUrl);

async function workerFunc(browser, url, baseUrl, cssSelectors) {
  let page = null;
  const urls = [];
  try {
    page = await browser.newPage();

    log(`New browser page for: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector(cssSelectors);

    const postsUrls = await page.evaluate((selectors) => {
      const anchors = Array.from(document.querySelectorAll(selectors));
      return anchors.map(anchor => anchor.firstElementChild.getAttribute('href'));
    }, cssSelectors);

    const addBaseUrl = parseUrlFor(baseUrl);
    urls.push(...postsUrls.map(addBaseUrl));
  } catch (error) {
    throw new Error(`The page ${url}, could not be loaded: ${error}`);
  } finally {
    if (page) {
      await page.close().catch(error => log(`Error closing page: (${url}): ${error}.`));
    }
  }
  return urls;
}

Apify.main(async () => {
  const input = await Apify.getValue('INPUT');
  if (!typeCheck(INPUT_TYPE, input)) {
    log('Expected input:');
    log(INPUT_TYPE);
    log('Received input:');
    console.dir(input);
    throw new Error('Received invalid input');
  }
  const { baseUrl, usernames, postsCSSSelectors } = input;

  const parseUrl = parseUrlFor(baseUrl);
  const usersUrls = [...usernames.map(parseUrl)];

  log('Openning browser...');
  const browser = await puppeteer.launch({
    args: ['--no-sandbox'],
    headless: !!process.env.APIFY_HEADLESS,
  });
  log('New browser window');

  const postsUrls = usersUrls.map(url => workerFunc(browser, url.href, baseUrl, postsCSSSelectors));
  const resolvePromises = await Promise.all(postsUrls);
  log(resolvePromises);

  // TODO: Get the state of crawling (the act might have been restarted)
  // state = await Apify.getValue('STATE') || DEFAULT_STATE
  await browser.close();
});
