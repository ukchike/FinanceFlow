# Modern / Newest Expense Tracking & Budgeting Apps (2023–2026)

Method note: research was search-snippet based. Direct fetches of 9to5mac.com, monarch.com and thenextweb.com were blocked by this session's network allowlist, so claims below come from search-result summaries of those pages and should be spot-checked. Five standouts chosen: Copilot Money, Monarch, Cleo 3.0, Actual Budget, Cashew. Also covered: the 2025–26 wave of indie on-device AI receipt apps.

## Launch/relaunch date, store ratings/downloads with source and date?

### Takeaway
The biggest relaunches are AI-assistant rebuilds in late 2025 and 2026 (Monarch Dec 2025, Copilot Oct 2026, Cleo 3.0 Jul 2025), plus Copilot's web expansion. Copilot still has no Android app. Open-source Actual Budget and Cashew are the local-first reference points.

### Cited Findings
- Copilot Money: web app launched Dec 15, 2025. Platforms are iPhone, iPad, Mac and web, US only. — [Copilot Dispatch](https://www.copilot.money/dispatch/web-app); [Copilot Help](https://help.copilot.money/en/articles/11780342-copilot-money-for-web)
- Copilot has no native Android app (Gerald article, June 2026). An androidexperto.com claim of an Android app conflicts with this and looks unreliable. — [Gerald](https://joingerald.com/learn/financial-wellness/copilot-money-android); [Copilot feedback board](https://feedback.copilot.money/feature-requests/p/copilot-android-app)
- Copilot Money Assistant (AI agent) launched about Oct 27, 2026, on iPhone first. — [9to5Mac](https://9to5mac.com/2026/10/27/copilot-money-gets-even-better-with-new-ai-powered-money-assistant/); [Copilot Dispatch beta post](https://www.copilot.money/dispatch/beta-introducing-your-money-assistant)
- Copilot ratings: 4.8 stars with 30,000+ reviews per its own FAQ. A tracker shows 4.8 with 27.5K reviews, and an outlier site shows 4.7 with 16,762. Copilot was a 2024 Apple Design Award finalist and an Editors' Choice. — [Copilot FAQ](https://www.copilot.money/faq); [App Store](https://apps.apple.com/us/app/id1447330651); [AppFollow](https://apps.appfollow.io/ios/copilot-track-budget-money/1447330651?country=us)
- Monarch: the AI Assistant first launched June 13, 2023 (Product Hunt). The Winter Release on Dec 18, 2025 brought a "reimagined" AI Assistant, goal planning, equity tracking and receipt scanning. — [Product Hunt](https://www.producthunt.com/posts/monarch-ai-assistant); [Monarch blog](https://www.monarch.com/blog/winter-release)
- Cleo 3.0 launched July 29, 2025. The company cites over 6M users and $250M ARR (company claims). — [BusinessWire](https://www.businesswire.com/news/home/20250729690058/en); [TNW](https://thenextweb.com/news/cleo-launches-ai-money-coach-fix-spending-habits)
- Actual Budget ships monthly releases, for example 25.3.0 (new bank-sync UI), 25.11.0 (mobile bank-sync settings) and 26.11.0 (automatic interval bank sync). — [Actual release notes](https://actualbudget.org/docs/releases); [Release 25.3.0](https://actualbudget.org/blog/release-25.3.0)
- Cashew has 500K+ Google Play downloads (reported) and about 4.5k GitHub stars. One review says the last open-source release was v5.3.4 (July 2024) and that the public code no longer matches the shipping app. — [AlternativeTo](https://alternativeto.net/software/cashew--expense-budget-tracker/about); [Pocket Clear comparison](https://pocketclear.app/blog/pocket-clear-vs-cashew.html)

### Inferences
- In 2025–26, "relaunch" mostly means bolting an agentic AI layer onto an existing aggregator app, not launching a new app.

### Gaps
- No verified Google Play download counts for Monarch or Cleo. Rocket Money, Origin, Toshl, Spendee and Wally redesigns were not verified because of the tool budget.
- Fina/Finny are ambiguous: several apps share these names. Finny (iOS) offers AI receipt and screenshot recognition, rollover budgets and $1.99/mo pricing. Fina Money is a web platform that launched on Product Hunt Nov 29, 2024. — [Finny App Store](https://apps.apple.com/app/id6736472735); [Fina Product Hunt](https://www.producthunt.com/products/fina/launches/fina-money)

## What specific new features or UX patterns does each introduce?

### Takeaway
The headline pattern is agentic chat: AI that acts on your data (creates budgets and rules, edits transactions) and alerts you proactively. Other new patterns are voice with memory (Cleo), personality modes ("roast mode"), receipt and screenshot capture, and Monarch's goal planning.

### Cited Findings
- Copilot Money Assistant:
  - It analyzes connected accounts and builds a starting budget during onboarding.
  - It can create, update and delete categories, budgets, transactions, recurring items and rules from chat.
  - It proactively flags unusual charges, budget spikes and chances to save.
  - Users can adjust its tone, including a "roast mode".
  - [App Store](https://apps.apple.com/us/app/-/id1447330651); [Copilot Dispatch](https://www.copilot.money/dispatch/beta-introducing-your-money-assistant); [9to5Mac](https://9to5mac.com/2026/10/27/copilot-money-gets-even-better-with-new-ai-powered-money-assistant/)
- Monarch AI: answers natural-language questions, explains changes and helps navigate the app. It cannot move money, and it asks before changing anything. — [Monarch Help](https://help.monarch.com/hc/en-us/articles/16116906962452-About-Monarch-s-AI-Features)
- Cleo 3.0: real-time two-way voice (tap the equalizer icon), long-term memory of goals and habits stored as summaries, and stronger reasoning. Voice runs on ElevenLabs. — [Cleo blog](https://web.meetcleo.com/blog/Introducing-cleo-3-0); [Cleo memory post](https://web.meetcleo.com/blog/memory-as-a-step-toward-more-human-ai); [ElevenLabs](https://elevenlabs.io/blog/cleo)
- Actual Budget: local-first envelope budgeting. The sync server can run inside the desktop app. Bank sync uses SimpleFIN (US) and Pluggy.ai (Brazil, experimental), with scheduled auto-sync. — [Actual releases](https://actualbudget.org/docs/releases)
- Cashew: custom budget periods, goals, subscription tracking, a PWA, biometric lock and free Google Drive backup. — [AlternativeTo](https://alternativeto.net/software/cashew--expense-budget-tracker/about)
- Budgety "Buddy AI" (May 2025): a chat assistant that flags unusual transactions and upcoming bills. — [Web Summit press release](https://vancouver.websummit.com/wp-media/2025/05/Budgety-Technologies-Ltd-Press-Release.pdf)
- Indie wave (2025–26 App Store listings): many apps claim on-device OCR and receipt parsing with Apple Intelligence, for example Receeto, Flux, ReceiptMint and Lowa. Finolio lets users bring their own Anthropic or xAI API key for cloud scanning. — [Receeto](https://apps.apple.com/app/id6760256602); [ReceiptMint](https://apps.apple.com/app/id6762583134); [Finolio](https://apps.apple.com/app/finolio/id6767923227)

### Inferences
- Agentic write access to budget data plus user-confirmation guardrails (Monarch's "asks before changing") is the pattern worth benchmarking.

### Gaps
- Widgets and Live Activities, novel visualizations and gamification were not verified for these apps.

## Which ideas work fully offline/on-device vs require a server or bank-aggregation APIs?

### Takeaway
The chat agents (Copilot, Monarch, Cleo) need bank aggregation plus cloud LLMs. Actual Budget and Cashew work offline, with optional sync or bank connectors. Receipt OCR is the AI feature now commonly done fully on-device.

### Cited Findings
- Copilot works only with US financial institutions. It says it does not sell data or train third-party models on it. — [Copilot FAQ](https://www.copilot.money/faq)
- Monarch says its AI providers can't train on users' conversations. — [Monarch Help](https://help.monarch.com/hc/en-us/articles/16116906962452-About-Monarch-s-AI-Features)
- Actual Budget is local-first, and bank sync needs a server plus SimpleFIN or Pluggy. — [Actual releases](https://actualbudget.org/docs/releases)
- Cashew is local, with optional Firebase/Pro cloud sync. — [Pocket Clear comparison](https://pocketclear.app/blog/pocket-clear-vs-cashew.html)
- On-device AI in the indie apps needs iOS 26 with Apple Intelligence. — [SnapCents](https://apps.apple.com/app/id6761669127)

### Inferences
- Local-first plus on-device OCR plus optional bring-your-own-key LLM is a feasible privacy-first architecture.

### Gaps
- Indie offline claims are developer marketing and were not independently verified.

## Pricing model?

### Takeaway
The premium AI apps are subscriptions. The open-source apps are free, with paid sync or hosting.

### Cited Findings
- Monarch costs about $14.99/mo (Penny Hoarder, 2026). — [Penny Hoarder](https://www.thepennyhoarder.com/budgeting/monarch-money-review/)
- Finny costs $1.99/mo or $17.99/yr. — [Finny App Store](https://apps.apple.com/app/id6736472735)
- Cashew's core is free, with an optional Pro cloud sync. — [Pocket Clear comparison](https://pocketclear.app/blog/pocket-clear-vs-cashew.html)
- Actual Budget is open source and self-hosted. — [Actual](https://actualbudget.org/docs/releases)
- Flux offers a one-time unlock or a subscription. — [Flux](https://apps.apple.com/app/id6756208417)

### Gaps
- Copilot and Cleo prices were not confirmed in sources fetched this session.
