# 🏰 Fortress Wallet

**Fortress Wallet** is a personal net-worth tracker that runs entirely in your browser. It covers an investment portfolio (ETFs, stocks, precious metals, bonds), cash, a home and a mortgage with prepayments. Your wallet is one JSON file that lives **on your device** and never touches a server. The interface is available in **English, Polish and Portuguese**.

Built with [TonkaJSX](https://github.com/Xaeian/TonkaJSX) and its TonkaUI kit: no bundler, no modules, a single static `index.html` when built.

![TonkaJSX](https://img.shields.io/badge/TonkaJSX-1.2-d8a57f)
![Static](https://img.shields.io/badge/hosting-static%20files-success)
![Data](https://img.shields.io/badge/data-your%20file-blue)
![Languages](https://img.shields.io/badge/i18n-EN%20%7C%20PL%20%7C%20PT-blue)

<!-- Add screenshots to docs/ and uncomment:
![Dashboard](docs/dashboard.png)
![Mortgage](docs/mortgage.png)
-->

---

## Why?

A spreadsheet stopped being enough once a mortgage joined the portfolio. Fortress Wallet:

- answers **"I have X € – what should I buy, and how many units?"** without ever selling anything,
- tracks **net worth** including the home and the outstanding mortgage,
- shows **what a prepayment is really worth** after the fee, and compares shortening the term with lowering the payment,
- keeps **your data yours**: the page is static files, and the wallet is a file you open from your own device.

## Features

| View | What it does |
|---|---|
| **Dashboard** | Net worth, allocation vs target, portfolio treemap, net worth history, drift of each ETF from its target |
| **Market** | Equities: buckets vs their planned shares (editable, add your own), each bucket's instruments and their percentages, what to buy for an amount, instruments moved between buckets, prices edited in a table, exchange rates (one click for today's ECB rates), new instruments |
| **Metals & bonds** | The same instrument table and add form for everything that is not equities |
| **Cash** | Cash accounts: roles, currencies and balances |
| **Transactions** | Buy / sell / adjust, cash deposits and withdrawals; deleting a transaction undoes it |
| **Contribution calculator** | Amount → emergency fund → prepayment pot → purchases by target; record the whole plan with one click |
| **Mortgage & home** | Payments (from the schedule or a bank statement), prepayments with a preview of their effect, balance and interest charts, yearly prepayment simulator |
| **Recommendations** | Automatic hints (emergency fund, limits, drift, stale prices, bond maturities, price alerts) + your strategy notes in Markdown |
| **Settings** | Language, allocation targets, buckets, budget |
| **Data & privacy** | How the app works in plain words, remembering the wallet file (off by default), what the browser holds now with a button that removes it, and whom the page talks to |

Also:
- 🌐 English / Polish / Portuguese, switchable at any time, remembered in your wallet file,
- 🌗 light and dark theme, remembered in your wallet file too,
- 📱 works on a phone (the layout adapts; you download the changed file),
- 📸 a net-worth snapshot on every change, which feeds the history chart.

## Where your data lives

In one file on your device. **File → Open a file.** In Chrome and Edge on a computer the app saves straight back into that file after every change. In other browsers (phones, Firefox, Safari) you **download** the updated file. The file holds everything: money, settings, theme, language and the price service key. It is not encrypted.

If the file changes on the disk while it is open here (a tool from `tools/`, another tab), the app does not write over it: it says so and lets you read the file again or write your version over it.

Nothing of it is sent to the server that hosts the page.

### What the browser remembers

**The app is cookie-free, and by default it keeps nothing in the browser.** A visit starts with the example data, in the browser's language and the system's theme.

One thing can be switched on in **Data & privacy**: remembering the open file. What is stored is a link to the file as the browser hands it out, with no content and no path, in IndexedDB (database `fortress-files`). The file is offered as **Open …** on the next visit. When the browser is told to allow it on every visit (Chrome 122 and newer), it opens by itself. The same page lists everything stored right now, including leftovers of older versions, and removes it with one button. It also explains in plain words how the app works and whom it talks to.

All of this is in `scripts/core/remember.js`. `privacy.test.cjs` reads every source, the UI kit's copy included, and finds browser storage in no other file; it reads the text, while what the browser enforces is the page's policy (below).

## Security

- The page requests data from its own server only, and from the exchange rate service (`api.frankfurter.dev`) after a click. The Content Security Policy in `app.html` says so and the browser enforces it. It makes leaking harder; it cannot protect against someone who controls the server, because they control the page and its policy. It covers requests, not leaving the page: a clicked link goes where it leads, so links in the notes of a wallet file work only towards web pages and e-mail addresses (`scripts/core/links.js`).
- **Give the app an address of its own** (`wallet.example.com`, not `example.com/wallet`). Browser storage and file permissions belong to the whole address, so every page of a shared one has them.
- Build with `-i -f`, so that no code or font is fetched from elsewhere; `.tests/build.test.cjs` checks a built `index.html` for it. A file over the size limit stays linked, and **Data & privacy** lists every server the page has fetched from.
- **Send the header below; it is not optional.** The built page keeps the policy of `app.html`, which still allows scripts from `unpkg.com` and `lib.tonkajsx.com` and fonts from `font.tonkajsx.com` for `tonka serve`. The header allows code and fonts written inside the page only, and the browser obeys both policies, so with it those servers are refused, a file that stayed linked included. It also refuses being shown inside another site's frame, which a policy in the page cannot.
- **Keep your wallet outside the project folder**, for example in your documents. `tonka serve` hands out the folder's files and may be reachable from your network. Git ignores `data/` (all but the example) and the tools' copies (`*.backup-*`) as a second line of defence, not as a place for the wallet.
- Upload the built files only, never the project folder.
- Send these headers from the server (the policy in the page stays in force beside them):

  ```
  Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src 'self' data: blob:; connect-src 'self' https://api.frankfurter.dev; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  ```

## Quick start

You need [Node.js](https://nodejs.org) and TonkaJSX:

```bash
git clone https://github.com/Xaeian/TonkaJSX.git
cd TonkaJSX
npm install
npm link                      # the `tonka` command works everywhere now

# put this project inside the TonkaJSX workspace
git clone https://github.com/<your-username>/fortress_wallet.git

tonka serve fortress_wallet   # http://localhost:3000
```

The app opens with example data (made-up numbers). Use **File** to open your own wallet, or start editing and save it.

### Build and deploy

```bash
tonka build fortress_wallet -i -f -s -c   # one self-contained index.html (+ .gz/.br)
tonka test fortress_wallet                # build.test.cjs now checks the built page
tonka deploy fortress_wallet              # to the folder or Worker named in app.ini [deploy]
```

The built page needs these files next to it (already listed in `app.ini` → `include`):

```
index.html
fortress.svg
locales/translations.toml
data/wallet.example.json
```

Any static hosting works: your own server, Cloudflare, GitHub Pages. Serve it over **HTTPS**, because opening and saving the file in place requires it. See [Security](#security) before publishing.

## Project structure

A standard TonkaJSX project: `.js` files load before `.jsx`, deeper folders first, everything is a global.

```
fortress_wallet/
├── app.html                  # entry for `tonka serve`
├── app.jsx                   # start-up: texts, wallet, app
├── app.ini                   # title, version, deploy target
├── fortress.svg              # icon
├── locales/
│   └── translations.toml     # every text in the app, EN / PL / PT side by side
├── data/
│   └── wallet.example.json   # example wallet (made-up numbers)
├── scripts/
│   ├── core/                 # plain JS – the part that never depends on the UI
│   │   ├── wallet/           # the wallet logic (`Core`), loaded in the order of the numbers:
│   │   │   ├── 1-base.js     #   names, texts, helpers, dates
│   │   │   ├── 2-mortgage.js #   schedule, prepayments
│   │   │   ├── 3-valuation.js #  worth in EUR, net worth
│   │   │   ├── 4-file.js     #   format version, migrations, checks, JSON
│   │   │   ├── 5-buckets.js  #   bucket percentages and their saves
│   │   │   ├── 6-plan.js     #   contribution calculator
│   │   │   ├── 7-forms.js    #   saves of the settings, cash, mortgage, transactions
│   │   │   ├── 8-history.js  #   snapshots, stored prices, chart ranges
│   │   │   └── 9-advice.js   #   recommendations
│   │   ├── i18n.js           # translations + number formats
│   │   ├── store.js          # the open wallet: source, saving, a file changed elsewhere
│   │   ├── files.js          # local files (File System Access API / download)
│   │   ├── remember.js       # the only place that keeps anything in the browser
│   │   ├── links.js          # where a link in the wallet's notes may lead
│   │   ├── online.js         # ECB exchange rates
│   │   └── config.js         # values from app.ini
│   ├── ui/                   # TonkaUI kit (copy, never edited here)
│   ├── App.jsx               # shell, navigation, file status, banners
│   ├── Dashboard.jsx … Settings.jsx   # one file per view
│   ├── FileDialog.jsx        # open / save
│   ├── Privacy.jsx           # data & privacy
│   ├── Charts.jsx            # SVG charts, no library
│   └── Widgets.jsx           # metric, editable table, expander, note, slider
├── styles/
│   ├── face/ ui/             # TonkaUI kit styles
│   └── app.css               # app styles and chart colours
├── tools/                    # Node scripts: XTB import, price history, reading and writing a wallet
└── .tests/                   # `tonka test fortress_wallet`
```

`scripts/core` has no JSX, and `wallet/` with `i18n.js` touches no DOM: they run in Node too (the tools and the tests load them), and would move to another framework with the `I18N` texts.

The files of `wallet/` load in the order of their numbers, as TonkaJSX loads a folder sorted by name (deeper folders first), and the tests read the folder the same way. `1-base.js` makes the global `Core`; each next file adds its part and takes from `Core` only what earlier files put there. A new part gets the number after the last file it needs.

## Translations

Every text lives in **`locales/translations.toml`**, with all languages side by side:

```toml
[flash_prepayment_booked]
en = "Prepayment of {amount} recorded."
pl = "Zaksięgowano nadpłatę {amount}."
pt = "Amortização antecipada de {amount} registada."
```

- Edit a text and reload the page.
- Keep the `{placeholders}` identical in every language.
- **Adding a language:** add it under `[_languages]` (e.g. `de = "Deutsch"`) and add a `de = "..."` line to every key. Anything missing falls back to English.
- `tonka test fortress_wallet` checks that every key has every language, that placeholders match, and that the code asks for no missing key.

## The wallet file

Plain JSON that you can read, diff and back up. Keep your own file outside the project folder (see [Security](#security)).

A file whose values the app cannot use (text where a number belongs, a negative price, an exchange rate of 0, an id such as `__proto__`) is refused, with the places to correct named; nothing in it is repaired without you.

The main keys:

| Key | Contents |
|---|---|
| `version` | the version of this format (now 6; a file without it is 1) |
| `settings.price_api_key` | your own [Alpha Vantage](https://www.alphavantage.co/support/#api-key) key. It is private: keep it in your file only, never in the example |
| `settings` | language, exchange rates (`fx`: units per 1 EUR), emergency fund target, income, % for prepayment, thresholds |
| `categories` | `equities`, `metals`, `bonds`: target % and `buy` (false = frozen: never bought, never sold) |
| `buckets` | groups inside a category, each with its share (`target_pct_in_category`) and an optional `max_pct_in_category` limit. Shares in a category and instrument targets in a bucket must add up to 100%, or be all 0 (you pick the instrument yourself); the calculator splits money by both |
| `assets` | instruments: currency, opening quantity, price, target within bucket, sell alert |
| `transactions` | buy / sell / adjust; quantity = opening quantity + transactions |
| `cash`, `cash_log` | cash accounts with a role (`emergency`, `prepay`, `home`, `other`) and their movements |
| `house`, `mortgage` | the home (price, value, deposit, deed date) and the loan (amount, rate, payments, fee, events) |
| `history` | net-worth snapshots: one for each day the wallet was changed, and one for each day with a stored price once `tools/fetch-prices.cjs` rebuilds them |
| `prices`, `fx_history` | stored prices (instrument → date → [opening or null, close], in its currency) and exchange rates by date |

Older files, including those of the earlier Python version (with Polish category ids), are migrated automatically when opened. A file of a newer version than the app knows is refused rather than guessed at.

**Changing the format** (a key added, removed or given a new meaning):

1. Raise `FORMAT` in `scripts/core/wallet/4-file.js`.
2. Add a step to `MIGRATIONS` that turns the previous version into the new one.
3. Update `SHAPE` and `VERSION` in `.tests/format.test.cjs`, and `version` in `data/wallet.example.json`.

## Broker history and prices

Two scripts fill a wallet file with your history. They run on your computer with Node and can be run again:

```bash
node tools/import-xtb.cjs ~/Documents/fortress/export.xlsx ~/Documents/fortress/wallet.json --dry-run   # XTB export: show, then run without --dry-run
node tools/fetch-prices.cjs ~/Documents/fortress/wallet.json            # weekly history + metals + exchange rates
node tools/fetch-prices.cjs ~/Documents/fortress/wallet.json --daily    # also openings and closes of the last 100 sessions
```

Before writing, each keeps the file as it was beside it, as `<name>.backup-<time>.json` (git ignores these; remove old ones yourself), and writes through a temporary file, so a broken run never leaves half a file.

`import-xtb` replaces what an earlier import brought in (transactions and cash operations whose ids start with `xtb-`) and sets the opening quantity of every imported instrument to 0, as the export holds all of its lots. A ticker of a market it does not know (London, for one, quotes in pence) is refused: add the market's currency to `MARKETS` in the script.

`fetch-prices` uses your [Alpha Vantage](https://www.alphavantage.co/support/#api-key) key from `settings.price_api_key` (free: 25 requests a day; answers are cached for the day in `data/price-cache/`, with the key blanked out) and the ECB rates, then rebuilds the net-worth history. Anything without a history, such as a home deposit or an instrument without a price symbol, counts as it is today.

Best close the wallet in the app before running them. If it stays open, the app notices on its next save that the file has changed, writes nothing and asks which version to keep.

## How it calculates

- **Base currency: EUR.** Every position is converted with `settings.fx`.
- **The contribution calculator** uses *water-filling*: it tops up the most underweight positions first until they reach a common level, then splits the rest by target. It never sells. Frozen categories are only diluted by new money.
- **Mortgage:** annuity, interest = balance × rate / 12. A prepayment either *shortens the term* (same payment, ends earlier) or *lowers the payment* (recalculated over the remaining term).
- **Net prepayment gain** = interest saved compared with no prepayments, minus fees.
- **Net worth** = investments + cash + (before the deed: deposit | after the deed: home value − mortgage balance).

In the app, prices of stocks, ETFs and metals are entered by hand; `tools/fetch-prices.cjs` fills them in from your computer (see above). Exchange rates come from the ECB via the free [Frankfurter API](https://frankfurter.dev).

## Tests

```bash
tonka test fortress_wallet          # or one suite: node .tests/<name>.test.cjs
```

| Suite | What it holds |
|---|---|
| `core` | valuation, the contribution calculator, the mortgage, recommendations |
| `market` | the market view's rules: percentages in a bucket are 100% or all 0%, bucket shares are 100%, moves and deletions keep that, the "what to buy" calculator, no sell alerts for equities |
| `rules` | the saves of the settings, cash, mortgage and transactions views: everything checked first, a refusal changes nothing |
| `format` | the file's version and keys, migrations, files refused for values the app cannot use |
| `history` | stored prices, the history built from them, the XTB import |
| `store` | saving: the autosave, changes during a save, a file changed elsewhere, downloads |
| `online` | the exchange rates: what is sent and what of the answer is taken |
| `links` | which links in the notes keep their address |
| `remember` | what the app keeps in the browser |
| `privacy` | a lint of the sources and the page's policy |
| `tools` | the .xlsx reader, the copies the tools keep, what git ignores, the price cache's names |
| `translations` | every key in every language, placeholders, number formats |
| `build` | the built `index.html`, when there is one |

### Manual checks

What the suites cannot reach, as they run in Node: worth a look before a release, in Chrome or Edge and in Firefox.

1. **Permission:** open your file, remember it in **Data & privacy**, reload the page, click **Open …**: the browser asks once or on every visit; both open the file.
2. **Two tabs:** open the same file in two tabs, change something in one, then in the other: the second shows *Changed on disk* and writes nothing until you choose.
3. **A tool meanwhile:** with the file open, run `fetch-prices` on it, then change something in the app: the same.
4. **Firefox:** change something, download, cancel the download: the message says nothing was saved; download again.
5. **Notes:** a note with `[x](javascript:alert(1))` shows *x* as plain text, and a note with `[x](https://example.com)` as a link.
6. **Built page:** after `tonka build … -i -f`, `tonka test` checks `index.html`; open it from the server with the header from [Security](#security) and look in **Data & privacy** at the servers fetched from: this page's own and nothing else.

## Disclaimer

This is a tool for your own record-keeping and calculations, not investment or tax advice. The mortgage schedule is an approximation; your bank's figures are binding.
