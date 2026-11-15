# FinanceFlow

## Phase 1: Backup and restore

The Android APK loads `financeflow-android/app/src/main/assets/index.html`; that is the packaged Android implementation. `finance-manager_2.jsx` is a separate React implementation and is not currently built or copied into the Android APK. The repository has no general React-to-Android asset pipeline. To keep backup behavior aligned, both implementations use the canonical `backup-core.mjs` schema and merge rules. After changing that module, run `node scripts/sync-backup-core.mjs` to regenerate the classic JavaScript asset loaded by Android. An automated test checks that the asset matches the canonical module.

The React app stores transactions, accounts, and budgets under its existing `fm_*` keys and retains imported category/profile metadata for backup round-tripping. Android continues to use its existing `ffd_*` local-storage keys and includes category definitions and profile data in its backups.

Restore accepts the legacy Android backup shape (`txns`, `budgets`, `accounts`, `userEC`, `userIC`, `profile`) and the React shape (`transactions`, `budgets`, `accounts`, `categories`, `profile`). New backups identify the `financeflow-backup` format and schema version 1; prior backups without those markers remain supported. Files are parsed and validated before changes are applied. Transactions, accounts, budgets, categories, and profile data are checked. Records are merged by ID: current records win ID conflicts, new records are appended, and records in sections omitted by a partial backup remain in place. Records without IDs receive generated IDs. Files larger than 25 MB, unsupported versions, invalid JSON, invalid section types, malformed records, and unrelated JSON are rejected with an error message.

Android restore uses the system document picker through the WebView file chooser callback, allowing the user to select a JSON document. Cancellation clears the pending chooser callback without changing saved data.

### Verification record

- Automated backup tests: 8 passed, 0 failed (`node --test tests/backup-core.test.mjs`).
- JavaScript syntax checks: shared canonical module, generated Android module, Android inline WebView script, and React JSX parser completed successfully.
- Android build: `gradlew.bat clean :app:assembleDebug` succeeded with Android SDK 34 and Java 17. The APK uses the standard debug signing key and is for testing only.
- Physical-device testing remains necessary for the system document picker, export destination, cancellation toast, and restore behavior against existing on-device records.
- The initial build exposed missing AndroidX configuration and malformed launcher icon resources; both were corrected to make the debug APK build reproducibly.

### Manual verification

1. Run `node --test tests/backup-core.test.mjs` and `node scripts/sync-backup-core.mjs` from the repository root.
2. Build and install the Android app, create a transaction and budget, then export a JSON backup.
3. Add a second transaction. Use Import from the dashboard or Profile settings, select the exported `.json` file in the Android document picker, and confirm both transactions remain.
4. Restore the same file again. Confirm there are no duplicate records with matching IDs.
5. Try malformed JSON, an unrelated JSON object, and a backup with a non-list `txns` value. Confirm each shows an error and leaves the existing records intact.
6. Select a backup over 25 MB and cancel the document picker. Confirm oversized files are rejected and cancellation leaves the app usable and saved data unchanged.
7. In the React app, export and restore a backup, then confirm transactions, accounts, budgets, and imported category/profile metadata are retained, local records win ID conflicts, and duplicate restore does not duplicate IDs.

## Phase 2: Project management

Both application implementations now support project records with a name, description, start and expected completion dates, budget, opening funded amount and active, paused, completed or cancelled status. Projects and commitments are saved independently from the existing financial record stores (`fm_projects` / `fm_commitments` in React and `ffd_projects` / `ffd_commitments` in Android) and are included in exports and safe, ID-based restore. Older backups that omit these sections continue to restore without removing locally stored projects or commitments.

Project expenses are existing transactions with an optional `projectId`. They remain in ordinary transaction totals and account history and are counted once in project reports; project views do not create a second transaction. Users can link transactions at entry or update the project assignment on an existing transaction. Project reports show selected-period and cumulative expenses, outstanding commitments, opening funding, project balance, budget remaining, funding progress and budget use. Period, category and account filters affect the expense list and selected-period total while cumulative figures remain all-time. Commitment amounts remain commitments until separately recorded as an expense; marking one paid changes its status and does not create another transaction.

The canonical calculations live in `project-core.mjs` and are imported by React and generated into `financeflow-android/app/src/main/assets/project-core.js` for Android. Run `node scripts/sync-project-core.mjs` after changing the canonical calculation module. Backup validation is shared through `backup-core.mjs`; run `node scripts/sync-backup-core.mjs` after modifying that module. Tests verify generated copies and both app entry points use the shared modules.

The opening funded amount is a Phase 2 summary value, not a funding ledger. Funding dates, sources, currencies, allocation rules, income links and history are part of the approved Phase 3 scope. No cloud service or database was added in this phase.

### Verification record

- Automated Node tests: 11 passed, 0 failed (`node --test tests/backup-core.test.mjs`), including project backup validation, malformed project rejection, project totals, commitments, report filters, shared-ledger preservation and Android/React shared-calculation parity.
- Android WebView inline JavaScript syntax check: passed.
- Android debug APK: `gradlew.bat clean :app:assembleDebug` succeeded with Java 17 and Android SDK 34. The app packages both generated shared modules.
- The Android debug APK is available at [FinanceFlow-phase-2-debug.apk](../outputs/FinanceFlow-phase-2-debug.apk) from the checkout's delivery folder. It uses the debug signing key and is for testing.
- The React implementation is a standalone JSX source in this repository with no package manifest or installed React build/parser toolchain; a React production build or browser workflow test could not be run from this checkout.
- No Android device or emulator was available. Device installation, project UI, transaction assignment, offline reload, and backup/restore with project data still need the manual checks below.

### Manual verification

1. Install the debug APK, add an existing expense, create a project, then assign that existing transaction to the project. Confirm the transaction stays in ordinary totals/account history and appears once in the project report.
2. Create a second transaction and link it to the project during entry. Confirm it appears in both normal transaction views and project reporting.
3. Edit the project name, description, dates, budget and opening funded amount. Check the balance, funding progress and budget remaining; pause, complete and cancel the project from its status control.
4. Add a commitment, verify it reduces project balance and budget remaining without changing expense totals, then mark it paid. Record the actual payment as a project-linked expense and confirm it is counted once.
5. Select a month, category and account. Confirm the displayed transaction list and selected-period amount change while cumulative expenses stay constant. Return to all time.
6. Force-close and reopen the app. Confirm projects, commitments and links remain. Export a backup, add another project, restore the backup, and confirm the local project remains, missing items are restored, and existing IDs are not duplicated.
7. Repeat the project, transaction assignment, persistence and backup checks in the React app when its host is available.
