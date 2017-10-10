const { URL } = require('url');
const Apify = require('apify');
const puppeteer = require('puppeteer');
const typeCheck = require('type-check').typeCheck;
const log = console.log;

// Definition of the input
const INPUT_TYPE = `{
  baseUrl: Maybe String,
  usernames: Maybe [String],
}`;

const randomInt = (maxExclusive) => ~~(Math.random() * maxExclusive);

const parseUrlFor = (baseUrl) => (input) => new URL(input, baseUrl);

async function workerFunc(browser, url) {
  try {
    const page = await browser.newPage();
    log('New browser page for: ' + url);
    await page.goto(url, {waitUntil: 'networkidle'});
    const html = await page.evaluate(body => body.innerHTML);
    log(html, 'aqui');
    pages.push(html);
  } catch(error) {
    throw new Error(`The page ${url}, could not be loaded: ${error}`);
  } finally {
    await browser.close();
  }
}
const pages = [];

Apify.main(async () => {
  // Fetch and check the input
  const input = await Apify.getValue('INPUT');
  if (!typeCheck(INPUT_TYPE, input)) {
    log('Expected input:');
    log(INPUT_TYPE);
    log('Received input:');
    console.dir(input);
    throw new Error("Received invalid input");
  }
  console.log(input.baseUrl, input.usernames);

  const parseUrl = parseUrlFor(input.baseUrl);

  const usersUrls = [].concat(input.usernames.map(parseUrl));
  console.log(usersUrls);

  const browser = await puppeteer.launch();

  workerFunc(browser, usersUrls[0].href);

  // Get the state of crawling (the act might have been restarted)
  // state = await Apify.getValue('STATE') || DEFAULT_STATE;
  await browser.close();
});