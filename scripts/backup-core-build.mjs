export function renderAndroidBackupCore(source) {
  return source.replace(/^export /gm, "") + "\nwindow.FinanceFlowBackup = { BACKUP_FORMAT, BACKUP_VERSION, MAX_BACKUP_BYTES, validateBackup, assertBackupSize, mergeBackupRecords };\n";
}
