# 🏰 Fortress Wallet

**Fortress Wallet** is a personal net-worth tracker that runs entirely in your browser. It covers an investment portfolio (ETFs, stocks, precious metals, bonds), cash, a home and a mortgage with prepayments. Your wallet is one JSON file that lives **on your device or on your Google Drive** and never touches a server. The interface is available in **English, Polish and Portuguese**.

Built with [TonkaJSX](https://github.com/Xaeian/TonkaJSX) and its TonkaUI kit: no bundler, no modules, a single static `index.html` when built.

![TonkaJSX](https://img.shields.io/badge/TonkaJSX-1.2-d8a57f)
![Static](https://img.shields.io/badge/hosting-static%20files-success)
![Data](https://img.shields.io/badge/data-your%20file%20%7C%20your%20Drive-blue)
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
- keeps **your data yours**: the page is static files, and the wallet is a file you open, on your device or your own Google Drive.

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

Also:
- 🌐 English / Polish / Portuguese, switchable at any time, remembered in your wallet file,
- 🌗 light and dark theme,
- 📱 works on a phone (the layout adapts, and the app can open your file from Google Drive),
- 📸 a net-worth snapshot on every change, which feeds the history chart.

## Where your data lives

| | How it works |
|---|---|
| **A file on this device** | **File → Open a file.** In Chrome and Edge on a computer the app saves straight back into that file after every change. After a reload you open it again. In other browsers (phones, Firefox, Safari) you **download** the updated file. |
| **Google Drive** | **File → Connect Google Drive.** The app asks Google for the narrowest permission there is, `drive.file`: it sees **only the files it created itself** (or that you pick for it), nothing else on your Drive. The file goes directly between your browser and Google. After about an hour, one click reconnects you. Changes made on another device are detected before anything is overwritten. |

Nothing is ever sent to the server that hosts the page.

**The app is cookie-free and keeps nothing in the browser:** no cookies, local or session storage, database or service worker. A reload starts again with the example data, in the browser's language and the system's theme. `privacy.test.cjs` guards this. Google Drive is off unless a Client ID is set in `app.ini`; turning it on loads Google's sign-in script, which uses Google's own cookies.

## Quick start

You need [Node.js](https://nodejs.org) and TonkaJSX:

```bash
git clone https://github.com/Xaeian/TonkaJSX.git
cd TonkaJSX
npm install
npm link                      # the `tonka` command works everywhere now

# put this project inside the TonkaJSX workspace
git clone https://github.com/<your-username>/fortress-wallet.git

tonka serve fortress-wallet   # http://localhost:3000
```

The app opens with example data (made-up numbers). Use **File** to open your own wallet, or start editing and save it.

### Build and deploy

```bash
tonka build fortress-wallet -i -f -s -c   # one self-contained index.html (+ .gz/.br)
tonka deploy fortress-wallet              # to the folder or Worker named in app.ini [deploy]
```

The built page needs these files next to it (already listed in `app.ini` → `include`):

```
index.html
fortress.svg
locales/translations.toml
data/wallet.example.json
```

Any static hosting works: your own server, Cloudflare, GitHub Pages. Serve it over **HTTPS**, because Google sign-in and in-place file saving require it.

### Google Drive (optional)

See **[GOOGLE_SETUP.md](GOOGLE_SETUP.md)**: about 10 minutes in Google Cloud Console, then paste the Client ID into `app.ini`. Without it the app works with local files only.

## Project structure

A standard TonkaJSX project: `.js` files load before `.jsx`, deeper folders first, everything is a global.

```
fortress-wallet/
├── app.html                  # entry for `tonka serve`
├── app.jsx                   # start-up: texts, Google, wallet, app
├── app.ini                   # title, version, Google IDs, deploy target
├── fortress.svg              # icon
├── locales/
│   └── translations.toml     # every text in the app, EN / PL / PT side by side
├── data/
│   └── wallet.example.json   # example wallet (made-up numbers)
├── scripts/
│   ├── core/                 # plain JS, no DOM – the part that never depends on the UI
│   │   ├── core.js           # valuation, calculator, mortgage, recommendations
│   │   ├── i18n.js           # translations + number formats
│   │   ├── store.js          # the open wallet: source, saving, conflicts, device copy
│   │   ├── files.js          # local files (File System Access API / download)
│   │   ├── drive.js          # Google Drive (drive.file scope)
│   │   ├── online.js         # ECB exchange rates
│   │   └── config.js         # values from app.ini
│   ├── ui/                   # TonkaUI kit (copy, never edited here)
│   ├── App.jsx               # shell, navigation, file status, banners
│   ├── Dashboard.jsx … Settings.jsx   # one file per view
│   ├── FileDialog.jsx        # open / save / Google Drive
│   ├── Charts.jsx            # SVG charts, no library
│   └── Widgets.jsx           # metric, editable table, expander, note, slider
├── styles/
│   ├── face/ ui/             # TonkaUI kit styles
│   └── app.css               # app styles and chart colours
└── .tests/                   # `tonka test fortress-wallet`
```

`scripts/core` has no DOM and no JSX, so it runs in Node too, and it would move to any other framework unchanged.

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
- `tonka test fortress-wallet` checks that every key has every language, that placeholders match, and that the code asks for no missing key.

## The wallet file

Plain JSON that you can read, diff and back up. Keep your own file in `data/`: git ignores everything there except the example.

The main keys:

| Key | Contents |
|---|---|
| `version` | the version of this format (now 4; a file without it is 1) |
| `settings.price_api_key` | your own [Alpha Vantage](https://www.alphavantage.co/support/#api-key) key. It is private: keep it in your file only, never in the example |
| `settings` | language, exchange rates (`fx`: units per 1 EUR), emergency fund target, income, % for prepayment, thresholds |
| `categories` | `equities`, `metals`, `bonds`: target % and `buy` (false = frozen: never bought, never sold) |
| `buckets` | groups inside a category, each with its share (`target_pct_in_category`) and an optional `max_pct_in_category` limit. Shares in a category and instrument targets in a bucket must add up to 100%, or be all 0 (you pick the instrument yourself); the calculator splits money by both |
| `assets` | instruments: currency, opening quantity, price, target within bucket, sell alert |
| `transactions` | buy / sell / adjust; quantity = opening quantity + transactions |
| `cash`, `cash_log` | cash accounts with a role (`emergency`, `prepay`, `home`, `other`) and their movements |
| `house`, `mortgage` | the home (price, value, deposit, deed date) and the loan (amount, rate, payments, fee, events) |
| `history` | daily net-worth snapshots |
| `prices`, `fx_history` | stored prices (instrument → date → [opening or null, close], in its currency) and exchange rates by date |

Older files, including those of the earlier Python version (with Polish category ids), are migrated automatically when opened. A file of a newer version than the app knows is refused rather than guessed at.

**Changing the format** (a key added, removed or given a new meaning):

1. Raise `FORMAT` in `scripts/core/core.js`.
2. Add a step to `MIGRATIONS` that turns the previous version into the new one.
3. Update `SHAPE` and `VERSION` in `.tests/format.test.cjs`, and `version` in `data/wallet.example.json`.

## Broker history and prices

Two scripts fill a wallet file with your history. They run on your computer with Node, keep a copy of the previous file beside it, and can be run again:

```bash
node tools/import-xtb.cjs data/export.xlsx data/my-wallet.json --dry-run   # XTB export: show, then run without --dry-run
node tools/fetch-prices.cjs data/my-wallet.json                            # weekly history + metals + exchange rates
node tools/fetch-prices.cjs data/my-wallet.json --daily                    # also openings and closes of the last 100 sessions
```

`fetch-prices` uses your [Alpha Vantage](https://www.alphavantage.co/support/#api-key) key from `settings.price_api_key` (free: 25 requests a day; answers are cached for the day) and the ECB rates, then rebuilds the net-worth history. Anything without a history, such as a home deposit or an instrument without a price symbol, counts as it is today. Close the wallet in the app before running them.

## How it calculates

- **Base currency: EUR.** Every position is converted with `settings.fx`.
- **The contribution calculator** uses *water-filling*: it tops up the most underweight positions first until they reach a common level, then splits the rest by target. It never sells. Frozen categories are only diluted by new money.
- **Mortgage:** annuity, interest = balance × rate / 12. A prepayment either *shortens the term* (same payment, ends earlier) or *lowers the payment* (recalculated over the remaining term).
- **Net prepayment gain** = interest saved compared with no prepayments, minus fees.
- **Net worth** = investments + cash + (before the deed: deposit | after the deed: home value − mortgage balance).

In the app, prices of stocks, ETFs and metals are entered by hand; `tools/fetch-prices.cjs` fills them in from your computer (see above). Exchange rates come from the ECB via the free [Frankfurter API](https://frankfurter.dev).

## Tests

```bash
tonka test fortress-wallet          # or: node .tests/core.test.cjs && node .tests/format.test.cjs && node .tests/market.test.cjs && node .tests/privacy.test.cjs && node .tests/translations.test.cjs
```

`market.test.cjs` holds the market view's rules: percentages in a bucket are 100% or all 0%, bucket shares are 100%, moves and deletions keep that, the "what to buy" calculator and no sell alerts for equities.

## Disclaimer

This is a tool for your own record-keeping and calculations, not investment or tax advice. The mortgage schedule is an approximation; your bank's figures are binding.
