# Mass-market manual expense trackers: UI/UX benchmark

Network note: in this session play.google.com, apps.apple.com, actualbudget.org, cashewapp.web.app and screensdesign.com could not be reached. Findings come from search-result snippets and the Cashew GitHub README. Items marked "(prior knowledge, unverified)" come from the researcher's background knowledge and have no source. They are offered as design hypotheses, not facts.

## Transaction entry speed (Monefy, Money Manager, Cashew, defaults, keypad, templates)

### Takeaway
The fastest pattern is Monefy's: the home screen *is* the entry screen. Category icons ring a donut chart, one tap opens an amount keypad, and saving updates the chart instantly. Cashew speeds up entry by auto-categorising from titles.

### Cited Findings
- Monefy's interface is built around a large, interactive donut chart, and the chart and balance update immediately after entry — [screensdesign showcase](https://screensdesign.com/showcase/monefy-money-tracker) (via search snippet)
- Monefy flow: open the app, tap a category, enter an amount, done. Users tap any category icon around the chart, enter the amount and press add — [omellody review](https://omellody.pages.dev/budget-apps/monefy/); [Softpedia](https://mobile.softpedia.com/android/Monefy-Android-Review-2301.html) (via snippets)
- Limit: with more than 14 categories, not all icons show on the Monefy main screen — [justuseapp reviews](https://justuseapp.com/en/app/1212024409/monefy-money-tracker/reviews) (via snippet)
- Cashew "Custom Titles": a title that matches a saved name assigns its category automatically, and similar names trigger suggestions. Users also choose whether new transactions default to expense or income — [Cashew GitHub](https://github.com/jameskokoska/Cashew)
- Cashew supports an `/addTransaction` deep link that adds a transaction with no UI prompt unless the category is missing — [Cashew FAQ](https://cashewapp.web.app/faq.html) (via snippet)
- Actual Budget mobile is used mainly for adding transactions on the go. Setup is done on desktop — [App Store listing reviews](https://apps.apple.com/us/app/id1444818585?l=en-us) (via snippet)
- Actual's mobile amount entry uses a decimal keyboard and selects the input on click. This comes from a fork commit, not an official source — [VT capstone fork](https://git.cs.vt.edu/danieljk/actual-vt-capstone/-/tree/f1973d55c03b31016851983945bf0d992c498f76)
- Actual recently fixed category learning for transactions entered or edited on mobile — [Actual releases](https://actualbudget.org/docs/releases) (via snippet)

### Inferences
- For a WebView app: put an in-app custom keypad on the entry sheet instead of the OS keyboard. Use a 4x4 grid of digits, `.`, backspace, and `+ − × ÷ =`, with a large right-aligned amount display. This avoids keyboard jank and adds calculator maths. (prior knowledge, unverified: Money Manager and Monefy both ship calculator-style keypads)
- Default the date to today and the account to the last one used. Pre-select the category from the title or the last one used. Offer a "save and add another" option. (prior knowledge, unverified)
- Show at most about 12–14 categories on the home grid, with "more" overflow, following Monefy's 14-icon limit.

### Gaps
- Could not verify Money Manager's calculator keypad or its "bookmark"/favourite transactions feature from a primary source, because the store pages were unreachable.
- Could not verify Cashew's add-transaction bottom sheet layout or its swipe actions. The README mentions only long-press plus swipe for multi-select on budgets.

## Home screen layout and period views

### Takeaway
Money Manager is known for date-centric tabs (daily, calendar, monthly). Monefy uses one donut summary per period. Cashew lets users customise the home screen with widgets.

### Cited Findings
- Money Manager users value its calendar for seeing daily, weekly and monthly spending. Some find it not intuitive and say it takes time to get used to — [App Store listing reviews](https://apps.apple.com/us/app/id560481810) (via snippets)
- Cashew's home screen is customisable ("layout and widgets"), and users switch account and currency from the homepage with automatic conversion — [Cashew GitHub](https://github.com/jameskokoska/Cashew)
- Money Lover is built around multiple "Wallets" (work, family, savings), and each transaction belongs to a wallet — [comparehero](https://comparehero.my/blog/money-lover-app-review-track-your-expenses) (via snippet)

### Inferences
- Pattern to copy: a sticky month header with ‹ › arrows and horizontal swipe to change period. Below it, show summary chips for Income, Expense and Total, then tabs for Daily list, Calendar grid (net amount per day cell, coloured +/−) and Monthly totals. (prior knowledge, unverified)

### Gaps
- Gesture specifics, such as swiping between months, could not be confirmed from sources.

## Category picker, account cards, budget visuals

### Takeaway
Use colour-coded icon circles in a grid. Show budgets as progress bars per period with history.

### Cited Findings
- Cashew lets users search icons when creating categories. It supports budgets with flexible or one-time periods, per-category limits, past budget history, and savings goals with progress — [Cashew GitHub](https://github.com/jameskokoska/Cashew)
- Users ask for more icon variety and subcategories (Monefy, Cashew) — [justuseapp](https://justuseapp.com/en/app/1212024409/monefy-money-tracker/reviews); [grand-screen](https://grand-screen.com/apps/cashew-expense-budget-tracker/reviews/) (via snippets)
- In Money Lover, a budget applies to one wallet only; a single budget can't span all wallets, which users criticise — [comparehero](https://comparehero.my/blog/money-lover-app-review-track-your-expenses) (via snippet)

### Inferences
- Let budgets span all accounts by default. In a progress bar, mark "today" so users can see whether spending is ahead of or behind pace. (prior knowledge, unverified for Cashew)

### Gaps
- No sourced pixel or spacing specifications.

## Charts, filters, search

### Takeaway
A donut chart for category share plus filterable search is the standard.

### Cited Findings
- Cashew has interactive graphs, plus search and filters by date, category, amount and tags — [Cashew GitHub](https://github.com/jameskokoska/Cashew)
- Money Lover forecasts future spending from history — [App Store listing](https://apps.apple.com/us/app/id486312413?l=en-us) (via snippet)

### Gaps
- Stats-screen layouts for Wallet and Money Manager were not verified.

## Theming, Material You, widgets, dark mode, accessibility, localisation

### Takeaway
Cashew is the reference for Material You: dynamic system accent colour, a custom accent colour, and light and dark modes. Monefy puts dark mode behind its paywall.

### Cited Findings
- Cashew follows Material You. Its accent colour can follow the system setting or be set manually, and it offers light and dark modes — [Cashew GitHub](https://github.com/jameskokoska/Cashew)
- Release notes mention improved colours when Material You is turned off, so it is optional — [newreleases Cashew 5.3.4](https://newreleases.io/project/github/jameskokoska/Cashew/release/5.3.4%2B396)
- Monefy puts recurring transactions, custom categories and dark mode behind a paywall — [screensdesign](https://screensdesign.com/showcase/monefy-money-tracker) (via snippet)

### Inferences
- In a WebView app, approximate Material You by deriving a tonal palette from one seed colour into CSS variables, and respect `prefers-color-scheme`.

### Gaps
- Accessibility and localisation details were not found for any of the apps.

## Common UX complaints

### Takeaway
The main complaints are paywalled basics (Monefy), the learning curve (Money Manager), bank-sync reliability and a dated UI (Wallet), and budgets limited to one wallet (Money Lover).

### Cited Findings
- Wallet: users praise the UX but call bank sync buggy, and one 2026 reviewer asks for a UI revamp. It is rated 4.6 on iOS and 4.5 on Google Play (more than 340k reviews) — [justuseapp Wallet](https://justuseapp.com/en/app/1032467659/wallet-finances-argent/reviews); [Finder](https://www.finder.com/uk/budgeting/wallet-budgetbakers-review) (via snippets)
- Money Manager offers an ad-free paid version ($5.99) and a sync subscription — [App Store](https://apps.apple.com/us/app/id564730202?l=en-us) (via snippet)
- Monefy is free with ads and limited features, has no bank sync, and offers very basic budgeting — [omellody](https://omellody.pages.dev/budget-apps/monefy/) (via snippet)
- Cashew is rated 4.8/5 from about 19.4k Google Play reviews, and its design is called top-notch — [grand-screen](https://grand-screen.com/apps/cashew-expense-budget-tracker/reviews/) (via snippet)

### Gaps
- No Reddit threads surfaced in search. Ad-placement complaints are thinly sourced.
