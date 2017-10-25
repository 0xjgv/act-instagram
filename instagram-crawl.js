// Crawl links.
const Apify = require('apify');
const puppeteer = require('puppeteer');
const { typeCheck } = require('type-check');

const { log, dir } = console;

const INPUT_TYPE = `{
  postCssSelector: String,
  extractActInput: Object | String
}`;

const results = {
  posts: [],
};

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

    results.posts.push(crawlResult);
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
  const input = await Apify.getValue('INPUT');
  if (!typeCheck(INPUT_TYPE, input)) {
    log('Expected input:');
    log(INPUT_TYPE);
    log('Received input:');
    dir(input);
    throw new Error('Received invalid input');
  }
  const {
    postCssSelector,
    extractActInput,
  } = input;

  log('Calling link-extractor with extractActInput...');
  const { output } = await Apify.call('juansgaitan/link-extractor', extractActInput);
  log('Link-Extractor Data: ', output.body);
  const arrayOfUsers = output.body;

  log('Openning browser...');
  const browser = await puppeteer.launch({
    args: ['--no-sandbox'],
    headless: !!process.env.APIFY_HEADLESS,
  });
  log('New browser window.');

  const crawlData = arrayOfUsers.map(({ username, postsLinks }) => (
    postsLinks.reduce((prev, url) => (
      prev.then(() => crawlUrl(browser, username, url, postCssSelector))
    ), Promise.resolve())
  ));
  await Promise.all(crawlData);

  log('SETTING OUTPUT RESULT...');
  await Apify.setValue('OUTPUT', results);

  const apifyClient = Apify.client;
  log(apifyClient);

  const storeName = 'tweets-instagram-posts';
  const store = await apifyClient.keyValueStores.getOrCreateStore({ storeName });
  apifyClient.setOptions({ storeId: store.id });

  let record = await apifyClient.keyValueStores.getRecord({ key: storeName });
  log('GETTING PREVIOUS RECORD: ', record);

  const finalResult = {
    posts: [],
  };
  if (record.body && record.body.posts.length) {
    const recordUrls = record.body.posts.map(({ url }) => url);
    const filtered = results.posts.filter(post => !recordUrls.includes(post.url));
    finalResult.posts.push(...filtered, ...record.body.posts);
    record = Object.assign({}, finalResult);
  } else {
    record = Object.assign({}, results);
  }

  await apifyClient.keyValueStores.putRecord({
    key: storeName,
    body: JSON.stringify(record, null, 2),
    contentType: 'application/json',
  });

  log('Closing browser.');
  await browser.close();
});
