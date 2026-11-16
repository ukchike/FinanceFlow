export function summarizeProject(project, transactions = [], commitments = [], filters = {}, amountOf = transaction => Number(transaction.amount || 0)) {
  if (!project) return { transactions: [], periodSpend: 0, cumulativeSpend: 0, committed: 0, funded: 0, balance: 0, budgetRemaining: 0, budgetUtilization: 0, fundingProgress: 0 };
  const expenses = transactions.filter(t => t.projectId === project.id && t.type === "expense");
  const visible = expenses.filter(t =>
    (!filters.period || filters.period === "all" || String(t.date || "").slice(0, 7) === filters.period) &&
    (!filters.category || filters.category === "all" || t.category === filters.category) &&
    (!filters.accountId || filters.accountId === "all" || t.accountId === filters.accountId)
  );
  const cumulativeSpend = expenses.reduce((sum, t) => sum + Number(amountOf(t) || 0), 0);
  const committed = commitments.filter(c => c.projectId === project.id && c.status === "open").reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const funded = Number(project.fundedAmount || 0);
  const budget = Number(project.budget || 0);
  return {
    transactions: visible,
    periodSpend: visible.reduce((sum, t) => sum + Number(amountOf(t) || 0), 0),
    cumulativeSpend,
    committed,
    funded,
    balance: funded - cumulativeSpend - committed,
    budgetRemaining: budget - cumulativeSpend - committed,
    budgetUtilization: budget > 0 ? Math.min((cumulativeSpend + committed) / budget * 100, 100) : 0,
    fundingProgress: budget > 0 ? Math.min(funded / budget * 100, 100) : 0
  };
}
