

Apify.main(async () => {
    // Get input of your act
    const input = await Apify.getValue('INPUT');
    console.log('My input:');
    console.dir(input);

    console.log(usersUrls);
    usersUrls
});

const URL = require('url');
const Apify = require('apify');
const utils = require('apify/build/utils');
const request = require('request-promise');
const async = require('async');
const typeCheck = require('type-check').typeCheck;
const log = console.log;

// TODO: save screenshots to kv-store

// Definition of the input
const INPUT_TYPE = `{
  baseUrl: Maybe String,
  usernames: Maybe [String],
  script: Maybe String,
  asyncScript: Maybe String,
  proxyUrls: Maybe [String],
  avoidCache: Maybe Boolean,
  cacheSizeMegabytes: Maybe Number,
  userAgents: Maybe [String],
  concurrency: Maybe Number,
  sleepSecs: Maybe Number,
  rawHtmlOnly: Maybe Boolean,
  compressedContent : Maybe Boolean,
  storePagesInterval: Maybe Number
}`;

const DEFAULT_STATE = {
  storeCount: 0,
  pageCount: 0,
};

const randomInt = (maxExclusive) => ~~(Math.random() * maxExclusive);

const parseUrlFor = (baseUrl) => (input) => new URL(input, baseUrl);

// Returns random array element, or null if array is empty, null or undefined.
const getRandomElement = (array) => 
  array && array.length ? array[randomInt(array.length)] : null;

const completeProxyUrl = (url) => 
  url ? url.replace(/<randomSessionId>/g, randomInt(999999999)) : url;

// Objects holding the state of the crawler, which is stored under 'STATE' key in the KV store
let state;

// Array of Page records that were finished but not yet stored to KV store
const finishedPages = [];

// Date when state and data was last stored
let lastStoredAt = new Date();

let isStoring = false;

let storePagesInterval = 50;

// If there's a long enough time since the last storing,
// stores finished pages and the current state to the KV store.
const maybeStoreData = async (force = false) => {
  // Is there anything to store?
  if (finishedPages.length === 0) return;

  // Is it long enough time since the last storing?
  if (!force && finishedPages.length < storePagesInterval) return;

  // Isn't some other worker storing data?
  if (isStoring) return;
  isStoring = true;

  try {
    // Store buffered pages to store under key PAGES-XXX
    // Careful here, finishedPages array might be added more elements while awaiting setValue()
    const pagesToStore = finishedPages.slice();
    const pagesToStoreLength = pagesToStore.length;
    const key = `PAGES-${(state.storeCount + 1 + '').padStart(9, '0')}`;

    log(`
      Storing ${pagesToStoreLength} pages to ${key} 
      (total pages crawled: ${state.pageCount + pagesToStoreLength})
    `); 

    await Apify.setValue(key, pagesToStore);

    finishedPages.splice(0, pagesToStoreLength);

    // Update and save state (but only after saving pages!)
    state.pageCount += pagesToStoreLength;
    state.storeCount++;
    await Apify.setValue('STATE', state);

    lastStoredAt = new Date();
  } catch (err) {
    // This is a fatal error, immediately stop the act
    if (err.message && ~err.message.indexOf('The POST payload is too large')) {
      log('FATAL ERROR');
      log(err.stack || err);
      process.exit(1);
    }
    if (force) throw err;
    log(`ERROR: Cannot store data (will be ignored): ${err.stack || err}`);
  } finally {
    isStoring = false;
  }
};

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

  const parseUrl = parseUrlFor(input.baseUrl);

  const usersUrls = input.usernames.map(parseUrl);

  // To Do: get urls from first page visit from 'executableScript' and append to input.urls
  // const executableScript = `
  //   const results = [];
  //   const allHrefs = document.querySelectorAll('h3[data-url]');
  //   for (let element of allHrefs) {
  //     if (!element.childElementCount && element.textContent != 'All') {
  //       results.push(element.dataset.url);
  //     }
  //   }
  //   return results;
  // `;

  // To Do: write a page to page 'executableScript'
  // const executableScript = `
  //   return 'entirePageHTML';
  // `;

  // Get list of URLs from an external text file and add valid URLs to input.urls
  input.urls = input.urls || [];
  if (input.urlToTextFileWithUrls) {
    log(`Fetching text file from ${input.urlToTextFileWithUrls}`);
    const request = await requestPromised({ url: input.urlToTextFileWithUrls });
    const textFile = request.body;
    log(`Processing URLs from text file (length: ${textFile.length})`);
    let count = 0;
    textFile.split('\n').forEach((url) => {
      url = url.trim();
      const parsed = URL.parse(url);
      if (parsed.host) {
        count++;
        input.urls.push(url);
      }
    });
    log(`Added ${count} URLs from the text file`);
  }

  if (input.storePagesInterval > 0) storePagesInterval = input.storePagesInterval;

  // Get the state of crawling (the act might have been restarted)
  state = await Apify.getValue('STATE') || DEFAULT_STATE;

  // Worker function, it crawls one URL from the list
  const workerFunc = async (url) => {
    const proxyUrlPattern = getRandomElement(input.proxyUrls);
    const proxyUrl = completeProxyUrl(proxyUrlPattern);

    const page = {
      url,
      loadingStartedAt: new Date(),
      userAgent: getRandomElement(input.userAgents),
      redactedProxyUrl: proxyUrl ? utils.redactUrl(proxyUrl) : null,
    };
    let browser;

    try {
      log(`Loading page: ${url} (proxyUrl: ${page.redactedProxyUrl})`);

      if (input.rawHtmlOnly) {
        // Open web page using request()
        const opts = {
          url,
          headers: page.userAgent ? { 'User-Agent': page.userAgent } : null,
          proxy: proxyUrl,
          gzip: !!(input.compressedContent)
        };

        const request = await requestPromised(opts);
        page.html = request.body;
        page.statusCode = request.response.statusCode;
        page.loadingFinishedAt = new Date();
        page.loadedUrl = url;
        page.scriptResult = null;
      } else {
        // Open web page using Chrome
        const opts = {
          url: page.url,
          userAgent: page.userAgent
        };
        opts.proxyUrl = proxyUrl;

        if (!input.avoidCache) {
          opts.extraChromeArguments = ['--disk-cache-dir=/tmp/chrome-cache/'];
          if (input.cacheSizeMegabytes > 0) {
            opts.extraChromeArguments.push(`--disk-cache-size=${input.cacheSizeMegabytes * 1024 * 1024}`);
          }
        }

        browser = await Apify.browse(opts);

        page.loadingFinishedAt = new Date();

        // Wait for page to load
        if (input.sleepSecs > 0) {
          await browser.webDriver.sleep(1000 * input.sleepSecs);
        }

        page.loadedUrl = await browser.webDriver.getCurrentUrl();

        // Run sync script to get data
        if (input.script) {
          page.scriptResult = await browser.webDriver.executeScript(input.script);
        } else {
          page.scriptResult = null;
        }

        // Run async script to get data
        if (input.asyncScript) {
          page.asyncScriptResult = await browser.webDriver.executeAsyncScript(input.asyncScript);
        } else {
          page.asyncScriptResult = null;
        }
      }
    } catch (e) {
      log(`Loading of web page failed (${url}): ${e}`);
      page.errorInfo = e.stack || e.message || e;
    } finally {
      if (browser) await browser.close();
    }

    log(`Finished page: ${page.url}`);

    finishedPages.push(page);
    await maybeStoreData();
  };

  const urlFinishedCallback = (err) => {
    if (err) {
      log(`WARNING: Unhandled exception from worker function: ${err.stack || err}`);
    }
  };

  const queue = async.queue(workerFunc, input.concurrency > 0 ? input.concurrency : 1);

  // Push all not-yet-crawled URLs to to the queue
  if (state.pageCount > 0) {
    log(`Skipping first ${state.pageCount} pages that were already crawled`);
    input.urls.splice(0, state.pageCount);
  }
  input.urls.forEach((url) => {
    queue.push(url, urlFinishedCallback);
  });

  // Wait for the queue to finish all tasks
  await new Promise((resolve) => {
   queue.drain = resolve;
  });

  await maybeStoreData(true);
});