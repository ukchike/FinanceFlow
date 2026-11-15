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
