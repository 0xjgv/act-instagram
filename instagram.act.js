const { URL } = require('url');
const Apify = require('apify');
const puppeteer = require('puppeteer');
const { typeCheck } = require('type-check');

const { log, dir } = console;

const INPUT_TYPE = `{
  baseUrl: String,
  cssSelectors: String,
  usernames: [String],
}`;

const parseUrlFor = baseUrl => input => new URL(input, baseUrl);
let parseUrl = null;

async function extractUrls(browser, url, selectors) {
  let page = null;
  const urls = [];
  try {
    page = await browser.newPage();

    log(`New browser page for: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector(selectors);
    const postsUrls = await page.evaluate((cssSelectors) => {
      const anchors = Array.from(document.querySelectorAll(cssSelectors));
      return anchors.map(anchor => anchor.firstElementChild.getAttribute('href'));
    }, selectors);

    const parsedPostsUrls = postsUrls.map(parseUrl);
    urls.push(...parsedPostsUrls);
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
    dir(input);
    throw new Error('Received invalid input');
  }
  const { baseUrl, usernames, cssSelectors } = input;

  log('Openning browser...');
  const browser = await puppeteer.launch({
    args: ['--no-sandbox'],
    headless: !!process.env.APIFY_HEADLESS,
  });
  log('New browser window.');

  parseUrl = parseUrlFor(baseUrl);
  const parsedUrls = [...usernames.map(parseUrl)];
  const allExtractedUrls = parsedUrls.map((url) => {
    const extractedUrl = extractUrls(browser, url.href, cssSelectors);
    return extractedUrl;
  });
  const urls = await Promise.all(allExtractedUrls);
  log(urls);

  // TODO: Get the state of crawling (the act might have been restarted)
  // state = await Apify.getValue('STATE') || DEFAULT_STATE
  log('Closing browser.');
  await browser.close();
});
