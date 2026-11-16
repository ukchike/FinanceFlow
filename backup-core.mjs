export const BACKUP_FORMAT = "financeflow-backup";
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function validateBackup(data) {
  if (!isObject(data)) throw new Error("The selected file is not a FinanceFlow backup.");
  if (data.format != null && data.format !== BACKUP_FORMAT) throw new Error("This file uses an unsupported backup format.");
  if (data.version != null && (!Number.isInteger(data.version) || data.version < 1 || data.version > BACKUP_VERSION)) {
    throw new Error(`Unsupported backup version: ${data.version}.`);
  }

  const normalized = { ...data };
  const arrays = { transactions: ["transactions", "txns"], accounts: ["accounts"], budgets: ["budgets"], projects: ["projects"], commitments: ["commitments"] };
  let found = false;
  for (const [field, aliases] of Object.entries(arrays)) {
    const key = aliases.find(alias => Object.prototype.hasOwnProperty.call(data, alias));
    if (!key) continue;
    found = true;
    if (!Array.isArray(data[key])) throw new Error(`Backup field “${key}” must be a list.`);
    normalized[field] = data[key];
  }
  if (Object.prototype.hasOwnProperty.call(data, "categories") || Object.prototype.hasOwnProperty.call(data, "userEC") || Object.prototype.hasOwnProperty.call(data, "userIC")) {
    found = true;
    const categories = data.categories ?? { expense: data.userEC, income: data.userIC };
    if (!isObject(categories)) throw new Error("Backup field “categories” is invalid.");
    for (const [name, values] of Object.entries(categories)) {
      if (values != null && (!isObject(values) || Object.values(values).some(list => !Array.isArray(list) || list.some(item => typeof item !== "string")))) {
        throw new Error(`Backup category group “${name}” is invalid.`);
      }
    }
    normalized.categories = categories;
  }
  if (Object.prototype.hasOwnProperty.call(data, "profile")) {
    found = true;
    if (!isObject(data.profile) || (data.profile.name != null && typeof data.profile.name !== "string")) throw new Error("Backup profile is invalid.");
  }
  if (!found) throw new Error("No transactions, accounts, budgets, projects, commitments, categories, or profile were found in this backup.");

  for (const [field, rows] of Object.entries({ transactions: normalized.transactions, accounts: normalized.accounts, budgets: normalized.budgets, projects: normalized.projects, commitments: normalized.commitments })) {
    if (!rows) continue;
    if (rows.some(row => {
      if (!isObject(row) || (row.id != null && !["string", "number"].includes(typeof row.id))) return true;
      if (field === "transactions") return row.amount == null || !Number.isFinite(Number(row.amount)) || Number(row.amount) < 0 || (row.type != null && !["income", "expense"].includes(row.type));
      if (field === "accounts") return typeof row.name !== "string" || !row.name.trim();
      if (field === "budgets") return row.limit == null || !Number.isFinite(Number(row.limit)) || Number(row.limit) < 0;
      if (field === "projects") return row.id == null || typeof row.name !== "string" || !row.name.trim() || !["active", "paused", "completed", "cancelled"].includes(row.status) || row.budget == null || !Number.isFinite(Number(row.budget)) || Number(row.budget) < 0 || (row.fundedAmount != null && (!Number.isFinite(Number(row.fundedAmount)) || Number(row.fundedAmount) < 0));
      return row.id == null || row.projectId == null || typeof row.description !== "string" || !row.description.trim() || !Number.isFinite(Number(row.amount)) || Number(row.amount) <= 0 || !["open", "paid", "cancelled"].includes(row.status);
    })) throw new Error(`Backup contains an invalid ${field.slice(0, -1)} record.`);
  }
  return normalized;
}

export function assertBackupSize(size) {
  if (!Number.isFinite(size) || size < 0 || size > MAX_BACKUP_BYTES) throw new Error("Backup file exceeds the 25 MB limit or has an invalid size.");
}

export function mergeBackupRecords(current, incoming) {
  const merged = [...current];
  const positions = new Map(merged.map((item, index) => [item.id, index]).filter(([id]) => id != null));
  incoming.forEach((item, index) => {
    if (item.id != null && positions.has(item.id)) return;
    const record = item.id == null
      ? { ...item, id: `restored_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 8)}` }
      : item;
    positions.set(record.id, merged.length);
    merged.push(record);
  });
  return merged;
}
