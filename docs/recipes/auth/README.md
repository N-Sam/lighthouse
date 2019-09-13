# Running Lighthouse on Authenticated Pages with Puppeteer

If you just want to view the code for using Lighthouse with Puppeteer, see [example-lh-auth.js](./example-lh-auth.js).

See [example-lh-auth.test.js](./example-lh-auth.test.js) for an example of how to run Lighthouse in your Jest tests on pages in both an authenticated and non-authenticated session.

## The Example Site

There are two pages on the site:

1. `/` - the homepage
2. `/dashboard`

The homepage shows the login form, but only to users that are not signed in.

The dashboard shows a secret to users that are logged in, but shows an error to users that are not.

The server responds with different HTML for each of these pages and session states, so there are four different pages that must have passable Lighthouse SEO scores.

(Optional) To run the server:
```sh
# be in root lighthouse directory
yarn # install global project deps
cd docs/auth
yarn # install deps related to just this documentation
yarn start # start the server on http://localhost:8000
```

## Process

Puppeteer - a browser automation tool - can be used to programatically setup a session.

1. Launch a new browser.
1. Navigate to the login page.
1. Fill and submit the login form.
1. Run Lighthouse using the same browser.

First, launch Chrome:
```js
// This port will be used by Lighthouse later.
const PORT = 8041;
const browser = await puppeteer.launch({
  args: [`--remote-debugging-port=${PORT}`],
  // Optional, if you want to see the tests in action.
  headless: false,
  slowMo: 50,
});
```

Navigate to the login form:
```js
const page = await browser.newPage();
await page.goto('http://localhost:8000');
```

Given a login form like this:
```html
<form action="/login" method="post">
  <label>
    Email:
    <input type="email" name="email">
  </label>
  <label>
    Password:
    <input type="password" name="password">
  </label>
  <input type="submit">
</form>
```

Direct Puppeteer to fill and submit it:
```js
const emailInput = await page.$('input[type="email"]');
await emailInput.type('admin@example.com');
const passwordInput = await page.$('input[type="password"]');
await passwordInput.type('password');
await Promise.all([
  page.$eval('.login-form', form => form.submit()),
  page.waitForNavigation(),
]);
```

At this point, the session that Puppeteer is managing is now logged in.

Close the page used to log in:
```js
await page.close();
// The page has been closed, but the browser still has the relevant session.
```

Now run Lighthouse, using the same port as before:
```js
const result = await lighthouse('http://localhost:8000/dashboard', { port: PORT });
const lhr = result.lhr;

# Direct Puppeteer to close the browser as we're done with it.
await browser.close();
```