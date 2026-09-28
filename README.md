# Republic Raid Tools

Local browser checks and manual Chrome DevTools Protocol (CDP) helpers for [The Republic](https://republic.legion.cc/raids).

The inspection command verifies the expected Republic and X accounts, reads the current raid list, and separates approved, pending, unsubmitted, expired, and uncertain states. It does not join raids, publish replies, react to posts, or submit proof.

The CDP helper supports explicitly supervised browser operations and local evidence records. It is not an unattended raid runner or an automatic retry system.

## Requirements

- Node.js 24 or later
- Google Chrome with a dedicated local debugging profile
- Your own Republic and X accounts, signed in manually

There are no third-party runtime dependencies. No package installation is needed.

## Private configuration

Copy the blank template to the ignored local directory:

```sh
mkdir -p .local
cp config.example.json .local/config.json
```

Edit **`.local/config.json`**, setting `expectedRepublicAccount` to the account username and `expectedXAccount` to the X handle. The X handle may include `@`. Do not put account names in the public template.

Both expected accounts must be configured before the inspection command connects to the browser. Invalid settings fail rather than disabling account checks.

Environment variables override the local file:

| Variable | Setting |
| --- | --- |
| `RAID_CDP_PORT` | Local debugging port; defaults to `19227` |
| `RAID_EXPECTED_REPUBLIC_ACCOUNT` | Expected Republic username |
| `RAID_EXPECTED_X_ACCOUNT` | Expected X handle |

Blank account environment variables clear the corresponding configured identity and prevent inspection. The CDP helper uses the same port configuration.

## Start Chrome

For example, from the project directory on macOS:

```sh
open -na "Google Chrome" --args --remote-debugging-address=127.0.0.1 --remote-debugging-port=19227 --user-data-dir="$PWD/.local/browser-profile" --no-first-run --no-default-browser-check
```

On other platforms, launch the installed Chrome executable with the equivalent flags and a dedicated profile directory. Keep the debugging interface local. Do not copy an ordinary browser profile or someone else's login data.

In that Chrome instance, open the Republic raid list and X. Complete both logins yourself and wait for the list to load. Republic's linked X account does not establish which account is actually signed in on X.

## Inspect and test

```sh
npm run inspect
npm test
```

Direct commands also work:

```sh
node scripts/check-browser.mjs
node --test tests/*.test.mjs
```

The inspector discovers current tab IDs, verifies each expected account separately, and reuses the raid-list GET URL observed in the page. It does not export cookies, tokens, browser storage, or form input values. It saves selected account and raid fields rather than unrelated page text.

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Both accounts match and the Republic list was read |
| `1` | Invalid configuration, connection failure, or request failure |
| `2` | A required tab, login, matching account, or loaded list needs attention |

Connection errors take precedence over missing tabs. Each completed attempt writes a fresh report, including failures. A successful check is not authorization to post or a guarantee that every raid can be resumed.

## Local records and privacy

The inspector writes `.local/checks/browser-check.json` and, when applicable, a screenshot of the authenticated Republic list. These files contain private account information. An inspection screenshot is not proof that raid tasks were completed.

The helper module writes records and screenshots under `.local/raids/`. Browser profiles, configuration, reports, screenshots, and agent state are excluded from Git. The repository uses an explicit public-file allowlist in `.gitignore`; newly created files need review before they can be tracked. Force-adding ignored files bypasses that protection.

Only source code, blank configuration, documentation, and synthetic tests belong in the public repository. Do not attach actual reports, screenshots, browser profiles, or account-specific URLs to public issues.

## Manual CDP helper

`scripts/raid-browser.mjs` exports `connect(site, tabId)`, `save(name, value)`, and the local record directory. `site` is `republic` or `x`. When more than one matching tab exists, an explicitly observed tab ID is required. Connections are restricted to the configured loopback debugging endpoint.

The returned client provides `send`, `evaluate`, `navigate`, `screenshot`, and `close`. These are low-level operations: callers must verify the current account, target, requirements, and authorization before making any change. The helper does not automatically enforce a complete submission workflow.

## State and recovery boundaries

- `submitted` means received for review; `completed` means approved.
- A joined but unsubmitted raid is `reconcile_required` because prior public activity may exist. Missing local history is not proof that no reply was posted.
- Missing, conflicting, rejected, or unknown submission states require review.
- Use server expiry timestamps and current time. A timer in an inactive tab can lag.
- If an attempt was recorded or a response timed out, reconcile the actual post and server state before retrying.
- Read each raid's actual requirements. A custom type alone does not establish which reactions or proof fields are required.
- Inspect actual screenshots before submitting evidence; never substitute a research screenshot or edited proof.

The current list is not a complete audit of historical submissions. There is no background monitoring, automatic posting queue, or automatic recovery of another environment's records.
