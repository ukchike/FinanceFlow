import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { renderAndroidBackupCore } from "../scripts/backup-core-build.mjs";
import { BACKUP_FORMAT, BACKUP_VERSION, MAX_BACKUP_BYTES, assertBackupSize, mergeBackupRecords, validateBackup } from "../backup-core.mjs";
import { summarizeProject } from "../project-core.mjs";

test("validates current React-format backups and legacy Android backups", () => {
  assert.equal(validateBackup({ transactions: [{ id: "t1", amount: 12 }], accounts: [{ id: "a1", name: "Cash" }], budgets: [{ id: "b1", limit: 100 }] }).transactions.length, 1);
  const legacy = validateBackup({ txns: [{ id: "t1", amount: "12", type: "income" }], userEC: { Food: ["Groceries"] }, userIC: { Salary: ["Main"] }, profile: { name: "Sam" } });
  assert.equal(legacy.transactions[0].id, "t1");
  assert.deepEqual(legacy.categories.expense.Food, ["Groceries"]);
});

test("exports a versioned backup that round-trips through the legacy Android field names", () => {
  const exported = JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, transactions: [{ id: "t1", amount: 8 }], accounts: [{ id: "a1", name: "Cash" }], budgets: [{ id: "b1", limit: 30 }], categories: { expense: { Food: ["Meals"] }, income: {} }, profile: { name: "Sam" } });
  const restored = validateBackup(JSON.parse(exported));
  assert.equal(restored.transactions[0].amount, 8);
  assert.equal(restored.categories.expense.Food[0], "Meals");
  const old = validateBackup({ txns: [{ id: "old", amount: 4 }], accounts: [{ name: "Cash" }], budgets: [], userEC: { Food: ["Meals"] }, userIC: {}, profile: { name: "Sam" } });
  assert.equal(old.transactions[0].id, "old");
  assert.equal(old.categories.expense.Food[0], "Meals");
});

test("rejects unsupported schemas and malformed financial records", () => {
  for (const backup of [null, [], { unrelated: true }, { format: "other", txns: [] }, { version: BACKUP_VERSION + 1, txns: [] }, { txns: "bad" }, { txns: [{ amount: "bad" }] }, { accounts: [{}] }, { budgets: [{ limit: -1 }] }, { userEC: { Food: "bad" } }, { profile: [] }]) {
    assert.throws(() => validateBackup(backup));
  }
});

test("merges missing IDs and keeps local records unchanged on conflicts", () => {
  const merged = mergeBackupRecords([{ id: "same", amount: 1 }, { id: "local" }], [{ id: "same", amount: 2 }, { id: "new", amount: 3 }]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].amount, 1);
  assert.equal(merged[1].id, "local");
});

test("validates project and commitment records and round-trips them in backups", () => {
  const project = { id: "p1", name: "Renovation", status: "active", budget: 1000, startDate: "2026-01-01" };
  const commitment = { id: "c1", projectId: "p1", description: "Materials", amount: 200, status: "open" };
  const result = validateBackup({ projects: [project], commitments: [commitment] });
  assert.equal(result.projects[0].name, project.name);
  assert.equal(result.commitments[0].amount, commitment.amount);
  assert.throws(() => validateBackup({ projects: [{ ...project, status: "running" }] }));
  assert.throws(() => validateBackup({ commitments: [{ ...commitment, amount: 0 }] }));
  assert.throws(() => validateBackup({ projects: [{ ...project, budget: -1 }] }));
  assert.throws(() => validateBackup({ projects: [{ ...project, id: null }] }));
});

test("project summaries apply filters while preserving cumulative totals and the shared ledger", () => {
  const project = { id: "p1", budget: 1000, fundedAmount: 700 };
  const transactions = [
    { id: "t1", projectId: "p1", type: "expense", amount: 100, date: "2026-11-03", category: "Materials", accountId: "cash" },
    { id: "t2", projectId: "p1", type: "expense", amount: 200, date: "2026-10-03", category: "Labour", accountId: "bank" },
    { id: "t3", projectId: "p1", type: "income", amount: 50, date: "2026-11-03", category: "Refund", accountId: "cash" },
    { id: "t4", type: "expense", amount: 900, date: "2026-11-03", category: "Materials", accountId: "cash" }
  ];
  const commitments = [{ id: "c1", projectId: "p1", status: "open", amount: 50 }, { id: "c2", projectId: "p1", status: "paid", amount: 100 }];
  const result = summarizeProject(project, transactions, commitments, { period: "2026-11", category: "Materials", accountId: "cash" });
  assert.deepEqual(result.transactions.map(t => t.id), ["t1"]);
  assert.equal(result.periodSpend, 100);
  assert.equal(result.cumulativeSpend, 300);
  assert.equal(result.committed, 50);
  assert.equal(result.balance, 350);
  assert.equal(result.budgetRemaining, 650);
  assert.equal(result.budgetUtilization, 35);
  assert.equal(result.fundingProgress, 70);
  assert.equal(transactions.length, 4);
  assert.equal(summarizeProject(null).transactions.length, 0);
});

test("accepts backups up to 25 MB and rejects oversized files", () => {
  assert.doesNotThrow(() => assertBackupSize(MAX_BACKUP_BYTES));
  assert.throws(() => assertBackupSize(MAX_BACKUP_BYTES + 1), /25 MB/);
});

test("Android uses a byte-for-byte copy of the canonical backup module", async () => {
  const source = await readFile(new URL("../backup-core.mjs", import.meta.url), "utf8");
  const android = await readFile(new URL("../financeflow-android/app/src/main/assets/backup-core.js", import.meta.url), "utf8");
  assert.equal(android, renderAndroidBackupCore(source));
});

test("Android runtime asset exposes the same schema validator and merge behavior", async () => {
  const android = await readFile(new URL("../financeflow-android/app/src/main/assets/backup-core.js", import.meta.url), "utf8");
  const context = { window: {} };
  vm.runInNewContext(android, context);
  const api = context.window.FinanceFlowBackup;
  assert.equal(api.validateBackup({ txns: [{ id: "old", amount: 1 }], userEC: {}, userIC: {} }).transactions[0].id, "old");
  assert.equal(api.mergeBackupRecords([{ id: "kept" }], [{ id: "new" }]).length, 2);
});

test("both application entry points use the shared backup core", async () => {
  const react = await readFile(new URL("../finance-manager_2.jsx", import.meta.url), "utf8");
  const android = await readFile(new URL("../financeflow-android/app/src/main/assets/index.html", import.meta.url), "utf8");
  assert.match(react, /from ["']\.\/backup-core\.mjs["']/);
  assert.match(android, /<script src="backup-core\.js"><\/script>/);
});

test("React and Android use the same project calculation module", async () => {
  const source = await readFile(new URL("../project-core.mjs", import.meta.url), "utf8");
  const android = await readFile(new URL("../financeflow-android/app/src/main/assets/project-core.js", import.meta.url), "utf8");
  assert.equal(android, source.replace(/^export /gm, "") + "\nwindow.FinanceFlowProject = { summarizeProject };\n");
  assert.match(await readFile(new URL("../finance-manager_2.jsx", import.meta.url), "utf8"), /from ["']\.\/project-core\.mjs["']/);
  assert.match(await readFile(new URL("../financeflow-android/app/src/main/assets/index.html", import.meta.url), "utf8"), /<script src="project-core\.js"><\/script>/);
  const context = { window: {} };
  vm.runInNewContext(android, context);
  assert.equal(context.window.FinanceFlowProject.summarizeProject({ id: "p", budget: 10 }, [{ projectId: "p", type: "expense", amount: 2 }]).cumulativeSpend, 2);
});
