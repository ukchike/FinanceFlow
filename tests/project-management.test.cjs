const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

test("project reporting preserves filtered and cumulative totals", async () => {
  const { summarizeProject } = await import("../project-core.mjs");
  const project = { id: "p1", budget: 1000, fundedAmount: 700 };
  const transactions = [
    { id: "t1", projectId: "p1", type: "expense", amount: 100, date: "2026-11-03", category: "Materials", accountId: "cash" },
    { id: "t2", projectId: "p1", type: "expense", amount: 200, date: "2026-10-03", category: "Labour", accountId: "bank" },
    { id: "t3", projectId: "p1", type: "income", amount: 50, date: "2026-11-03", category: "Refund", accountId: "cash" },
    { id: "t4", type: "expense", amount: 900, date: "2026-11-03", category: "Materials", accountId: "cash" }
  ];
  const commitments = [
    { id: "c1", projectId: "p1", status: "open", amount: 50 },
    { id: "c2", projectId: "p1", status: "paid", amount: 100 }
  ];
  const report = summarizeProject(project, transactions, commitments, { period: "2026-11", category: "Materials", accountId: "cash" });
  assert.deepEqual(report.transactions.map(row => row.id), ["t1"]);
  assert.equal(report.periodSpend, 100);
  assert.equal(report.cumulativeSpend, 300);
  assert.equal(report.committed, 50);
  assert.equal(report.balance, 350);
  assert.equal(report.budgetRemaining, 650);
  assert.equal(report.budgetUtilization, 35);
  assert.equal(report.fundingProgress, 70);
  assert.equal(transactions.length, 4);
});

test("project reports accept primary-currency conversion for Android transactions", async () => {
  const { summarizeProject } = await import("../project-core.mjs");
  const report = summarizeProject({ id: "p", budget: 300 }, [
    { id: "t", projectId: "p", type: "expense", amount: 100, date: "2026-11-01" }
  ], [], {}, row => row.amount * 1.5);
  assert.equal(report.cumulativeSpend, 150);
  assert.equal(report.budgetRemaining, 150);
});

test("React and Android validate project backups and keep local ID conflicts", async () => {
  const { validateBackup, mergeBackupRecords } = await import("../backup-core.mjs");
  const project = { id: "p1", name: "Renovation", status: "active", budget: 1000, fundedAmount: 250 };
  const commitment = { id: "c1", projectId: "p1", description: "Materials", amount: 100, status: "open" };
  const backup = validateBackup({ projects: [project], commitments: [commitment] });
  assert.equal(backup.projects[0].name, project.name);
  assert.equal(backup.commitments[0].amount, 100);
  assert.throws(() => validateBackup({ projects: [{ ...project, status: "running" }] }));
  assert.throws(() => validateBackup({ commitments: [{ ...commitment, amount: 0 }] }));
  assert.deepEqual(mergeBackupRecords([{ id: "p1", name: "Local" }], [project]), [{ id: "p1", name: "Local" }]);
});

test("Full Android backup validation handles project records and legacy backups safely", async () => {
  const html = await readFile(path.join(__dirname, "..", "financeflow-android", "app", "src", "main", "assets", "index.html"), "utf8");
  const projectSource = await readFile(path.join(__dirname, "..", "project-core.mjs"), "utf8");
  const projectAsset = await readFile(path.join(__dirname, "..", "financeflow-android", "app", "src", "main", "assets", "project-core.js"), "utf8");
  assert.equal(projectAsset, projectSource.replace(/^export /gm, "") + "\nwindow.FinanceFlowProject = { summarizeProject };\n");
  assert.match(html, /projects=Array\.isArray\(d\.projects\)\?d\.projects:projects/);
  assert.match(html, /commitments=Array\.isArray\(d\.commitments\)\?d\.commitments:commitments/);
  const start = html.indexOf("function validateBackupData(d){");
  const next = html.indexOf("function applyBackupData", start);
  assert.notEqual(start, -1);
  assert.notEqual(next, -1);
  const code = html.slice(start, next).trimEnd();
  const context = {
    CURRENCIES: [{ code: "NGN" }],
    FinanceCore: {
      date: value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
      round: value => Math.round(value * 100) / 100
    }
  };
  const validate = vm.runInNewContext(`${code}; validateBackupData;`, context);
  const legacy = { version: 3, txns: [{ id: "t1", type: "expense", amount: 10, date: "2026-11-01", accountId: "a1" }], accounts: [{ id: "a1", name: "Cash" }] };
  assert.equal(validate(legacy).version, 3);

  const backup = {
    version: 4,
    txns: [{ id: "t1", type: "expense", amount: 10, date: "2026-11-01", accountId: "a1", projectId: "p1" }],
    accounts: [{ id: "a1", name: "Cash" }],
    projects: [{ id: "p1", name: "Renovation", status: "active", budget: 100, fundedAmount: 50, startDate: "2026-01-01" }],
    commitments: [{ id: "c1", projectId: "p1", description: "Materials", amount: 20, status: "open", dueDate: "2026-12-01" }]
  };
  assert.equal(validate(backup).projects[0].name, "Renovation");
  assert.throws(() => validate({ ...backup, projects: [{ ...backup.projects[0], budget: -1 }] }), /Invalid project/);
  assert.throws(() => validate({ ...backup, commitments: [{ ...backup.commitments[0], projectId: "missing" }] }), /Invalid project commitment/);
  assert.throws(() => validate({ ...backup, txns: [{ ...backup.txns[0], projectId: "missing" }] }), /project missing/);
});
