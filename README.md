# Vote Button Diagnostics (local/test only)

This utility records browser diagnostics for a manually triggered button on a local or test deployment. It does not automate voting, replay requests, alter cookies, clear storage, or bypass vote limits.

## Safety guard

The script refuses URLs outside:
- localhost / 127.0.0.1 / ::1
- domains ending in .localhost or .test

Do not weaken this guard to point it at a live public contest.

## Run

Requires Node.js 20+.

```bash
npm install
npx playwright install chromium
TEST_URL=http://localhost:3000 npm run diagnose
```

A browser opens. Navigate to the test page if needed, then manually click the test vote button once. Return to the terminal and press Enter to finish.

The report records same-origin request method/path/status, failed requests, browser console errors and page errors. Query strings, request bodies, cookies and authorization headers are never printed.

## What this can establish

- Whether a click triggers same-origin network traffic.
- Whether a request fails at the network layer or returns an HTTP error.
- Whether the browser reports JavaScript errors during the test.

It cannot prove that a vote was committed in the database. Confirm that separately in test-server logs / test database.

Use only against an environment you control or are explicitly authorized to test.
