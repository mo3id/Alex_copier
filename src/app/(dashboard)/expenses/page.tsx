"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { useI18n } from "@/i18n/context";
import Pagination from "@/components/Pagination";
import SearchInput, { matchesQuery } from "@/components/SearchInput";
import FilterSelect from "@/components/FilterSelect";
import CompanyTabs from "@/components/CompanyTabs";
import DateRangeFilter, { inDateRange } from "@/components/DateRangeFilter";
import { Eye, Pencil, Plus, Receipt, Save, Tags, CalendarDays, Wallet, Trash2, X } from "lucide-react";
import ExportButton from "@/components/ExportButton";
import PrinterLoader from "@/components/PrinterLoader";
import { AddFormBoundary } from "@/hooks/useAutoAddForm";
import FormModal from "@/components/FormModal";
import SelectWithAdd from "@/components/SelectWithAdd";
import StatsCards from "@/components/StatsCards";
import SubmitButton from "@/components/SubmitButton";
import { DateTimeCell } from "@/components/DateTimeCell";
import { useConfirm, useToast } from "@/components/UIProvider";
import { apiErrorMessage, fill } from "@/lib/api-client";
import { apiFetch } from "@/lib/fetch-client";
import { useRouter } from "next/navigation";
import RefreshButton from "@/components/RefreshButton";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { notifyDataChanged } from "@/lib/data-events";
import { formatEgyptDateISO } from "@/lib/datetime";

interface Company { id: string; name: string; }
interface Category { id: string; name: string; companyId?: string; }
interface Expense {
  id: string; companyId: string; categoryId: string | null; category: string; description: string; amount: number;
  paidBy: string; date: string; createdAt: string; company: Company;
  payer?: { id: string; name?: string | null };
  expenseCategory?: { id: string; name: string } | null;
}

const payerName = (expense: Expense) => expense.payer?.name || expense.paidBy;
const MAX_EXPENSE_ROWS = 50;

interface ExpenseRow {
  key: string;
  categoryId: string;
  category: string;
  description: string;
  amount: string;
}

export default function FinancePage() {
  const { t, dir } = useI18n();
  const router = useRouter();
  const confirmAction = useConfirm();
  const { success: toastSuccess, error: toastError } = useToast();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Expense | null>(null);
  const [formError, setFormError] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const rowIdRef = useRef(0);
  const makeRow = useCallback(
    (): ExpenseRow => ({ key: `expense-row-${++rowIdRef.current}`, categoryId: "", category: "", description: "", amount: "" }),
    []
  );
  const [rows, setRows] = useState<ExpenseRow[]>(() => [
    { key: "expense-row-0", categoryId: "", category: "", description: "", amount: "" },
  ]);
  const PAGE_SIZE = 10;

  const fetchData = useCallback(async () => {
    try {
      const [expenseResult, companyResult, categoryResult] = await Promise.all([
        apiFetch<Expense[]>("/api/expenses", { action: "load expenses" }),
        apiFetch<Company[]>("/api/companies", { action: "load companies" }),
        apiFetch<Category[]>("/api/expense-categories", { action: "load expense categories" }),
      ]);
      if (
        expenseResult.response.status === 401 ||
        companyResult.response.status === 401 ||
        categoryResult.response.status === 401
      ) {
        signOut({ callbackUrl: "/login" });
        return;
      }
      setExpenses(Array.isArray(expenseResult.data) ? expenseResult.data : []);
      setCompanies(Array.isArray(companyResult.data) ? companyResult.data : []);
      setCategories(Array.isArray(categoryResult.data) ? categoryResult.data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  const { refresh, refreshing } = useAutoRefresh(fetchData, ["expenses", "companies"], { immediate: true });

  useEffect(() => {
    const handler = () => {
      setCompanyId("");
      setRows([makeRow()]);
      setEditingId(null);
      setFormError("");
      setShowForm(true);
    };
    window.addEventListener("erp-open-add", handler);
    return () => window.removeEventListener("erp-open-add", handler);
  }, [makeRow]);

  const filtered = expenses.filter((expense) => {
    const matchesCompany = !companyFilter || expense.companyId === companyFilter;
    let matchesCategory = true;
    if (categoryFilter) {
      const filterCatObj = categories.find((c) => c.id === categoryFilter);
      const filterCatName = filterCatObj?.name || categoryFilter;
      const expCatName = expense.expenseCategory?.name || expense.category;
      const expCatId = expense.expenseCategory?.id || expense.categoryId;
      matchesCategory = expCatId === categoryFilter || expCatName === filterCatName;
    }
    return (
      matchesCompany &&
      matchesCategory &&
      inDateRange(expense.date || expense.createdAt, dateFrom, dateTo) &&
      (matchesQuery(expense.category, search) ||
        matchesQuery(expense.description, search) ||
        matchesQuery(expense.company?.name, search))
    );
  });

  const hasActiveFilters = companyFilter !== "" || categoryFilter !== "" || dateFrom !== "" || dateTo !== "" || search !== "";
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const today = formatEgyptDateISO(new Date());
  const currentMonth = today.slice(0, 7);
  const total = filtered.reduce((sum, e) => sum + (e.amount || 0), 0);
  const todayTotal = filtered
    .filter((e) => (e.date || e.createdAt).slice(0, 10) === today)
    .reduce((sum, e) => sum + (e.amount || 0), 0);
  const monthTotal = filtered
    .filter((e) => (e.date || e.createdAt).slice(0, 7) === currentMonth)
    .reduce((sum, e) => sum + (e.amount || 0), 0);
  const stats = { count: filtered.length, total, today: todayTotal, month: monthTotal };
  const batchTotal = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  // Deduplicated category options for table filter:
  const filterCategories = companyFilter
    ? categories.filter((c) => c.companyId === companyFilter)
    : categories;
  const uniqueFilterCategories: { id: string; name: string }[] = [];
  const seenFilterNames = new Set<string>();
  for (const cat of filterCategories) {
    if (!seenFilterNames.has(cat.name)) {
      seenFilterNames.add(cat.name);
      uniqueFilterCategories.push({ id: cat.id, name: cat.name });
    }
  }
  const categoryFilterOptions = uniqueFilterCategories.map((c) => ({ value: c.id, label: c.name }));

  // Deduplicated and company-filtered category options for modal form:
  const modalCategories = companyId
    ? categories.filter((c) => c.companyId === companyId)
    : categories;
  const uniqueFormCategories: { id: string; name: string }[] = [];
  const seenFormNames = new Set<string>();
  for (const cat of modalCategories) {
    if (!seenFormNames.has(cat.name)) {
      seenFormNames.add(cat.name);
      uniqueFormCategories.push({ id: cat.id, name: cat.name });
    }
  }
  const formCategoryOptions = uniqueFormCategories.map((c) => ({ value: c.id, label: c.name }));

  const exportExpenses = () => ({
    headers: [
      t("common.date"),
      t("common.company"),
      t("finance.category"),
      t("common.description"),
      t("common.amount"),
      t("finance.paidBy"),
    ],
    rows: filtered.map((expense) => [
      new Date(expense.date || expense.createdAt).toISOString().slice(0, 10),
      expense.company?.name || "",
      expense.expenseCategory?.name || expense.category,
      expense.description,
      String(expense.amount),
      payerName(expense),
    ]),
  });

  const openCreate = () => {
    setCompanyId("");
    setRows([makeRow()]);
    setEditingId(null);
    setFormError("");
    setShowForm(true);
  };

  const openEdit = (expense: Expense) => {
    setSelected(null);
    setCompanyId(expense.companyId);
    setRows([
      {
        ...makeRow(),
        categoryId: expense.expenseCategory?.id || expense.categoryId || "",
        category: expense.expenseCategory?.name || expense.category,
        description: expense.description,
        amount: String(expense.amount),
      },
    ]);
    setEditingId(expense.id);
    setFormError("");
    setShowForm(true);
  };

  const patchRow = (key: string, patch: Partial<ExpenseRow>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const changeCompany = (value: string) => {
    setCompanyId(value);
    setRows((prev) => prev.map((row) => ({ ...row, categoryId: "", category: "" })));
  };

  const selectCategory = (key: string, categoryId: string) => {
    const category = categories.find((c) => c.id === categoryId);
    patchRow(key, { categoryId, category: category?.name || "" });
  };

  const addExpenseRow = () => {
    if (rows.length >= MAX_EXPENSE_ROWS) return;
    setRows((prev) => [...prev, makeRow()]);
  };

  const removeExpenseRow = (key: string) => {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((row) => row.key !== key)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!companyId) {
      setFormError(t("finance.selectCompany"));
      return;
    }
    if (rows.length > MAX_EXPENSE_ROWS) {
      setFormError(t("finance.maxRows"));
      return;
    }

    const prepared = rows.map((row) => ({
      categoryId: row.categoryId || null,
      category: row.category.trim(),
      description: row.description.trim(),
      amount: Number(row.amount),
    }));
    const invalidIndex = prepared.findIndex(
      (row) =>
        (!row.categoryId && !row.category) ||
        !row.description ||
        !Number.isFinite(row.amount) ||
        row.amount <= 0
    );
    if (invalidIndex >= 0) {
      setFormError(`${t("finance.invalidRow")} ${invalidIndex + 1}`);
      return;
    }

    setSaving(true);
    try {
      const editing = Boolean(editingId);
      const { response, data } = await apiFetch<{ error?: string }>(
        editing ? `/api/expenses/${editingId}` : "/api/expenses/batch",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editing ? { companyId, ...prepared[0] } : { companyId, items: prepared }),
          action: editing ? "update expense" : "add expenses",
          timeoutMs: 45_000,
        }
      );

      if (response.status === 401) {
        signOut({ callbackUrl: "/login" });
        return;
      }
      if (!response.ok) {
        setFormError(apiErrorMessage(data, t));
        return;
      }

      setCompanyId("");
      setRows([makeRow()]);
      setEditingId(null);
      setShowForm(false);
      toastSuccess(
        editing
          ? t("common.savedSuccessfully")
          : fill(t("finance.addedExpenses"), { count: prepared.length })
      );
      refresh();
      notifyDataChanged(["expenses"]);
    } catch {
      setFormError(t("common.connectionError"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirmAction({ message: t("common.deleteConfirm") }))) return;
    try {
      const { response, data } = await apiFetch<{ error?: string }>(`/api/expenses/${id}`, {
        method: "DELETE",
        action: "delete expense",
      });
      if (response.status === 401) {
        signOut({ callbackUrl: "/login" });
        return;
      }
      if (!response.ok) {
        toastError(apiErrorMessage(data, t));
        return;
      }
      setSelected(null);
      toastSuccess(t("common.deletedSuccessfully"));
      refresh();
      notifyDataChanged(["expenses"]);
    } catch {
      toastError(t("common.connectionError"));
    }
  };

  return (
    <div dir={dir} className="space-y-5">
      <AddFormBoundary />
      <div className="space-y-5">
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium tracking-[0.2em] text-sky-600 uppercase">ERP</p>
            <h1 className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl lg:text-3xl">
              {t("finance.expenses")}
              <span className="ms-2 text-sm font-medium text-gray-400">({filtered.length})</span>
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={openCreate} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700"><Plus size={16} />{t("finance.addMultiple")}</button>
            <button onClick={() => router.push("/expenses/categories")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm font-semibold text-orange-700 transition hover:bg-orange-100"><Tags size={16} />{t("finance.expenseCategories")}</button>
          </div>
        </div>

        <StatsCards
          columns={4}
          stats={[
            { label: t("finance.stats.count"), value: stats.count.toLocaleString("ar-EG"), icon: <Receipt size={18} />, tone: "sky" },
            { label: t("finance.stats.total"), value: `${stats.total.toLocaleString("ar-EG")} ج.م`, icon: <Wallet size={18} />, tone: "purple" },
            { label: t("finance.stats.today"), value: `${stats.today.toLocaleString("ar-EG")} ج.م`, icon: <CalendarDays size={18} />, tone: "amber" },
            { label: t("finance.stats.thisMonth"), value: `${stats.month.toLocaleString("ar-EG")} ج.م`, icon: <CalendarDays size={18} />, tone: "green" },
          ]}
        />

        {formError && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="status">
            <span>{formError}</span>
            <button onClick={() => setFormError("")} aria-label={t("common.close")} className="text-inherit">✕</button>
          </div>
        )}

        <FormModal
          open={showForm}
          onClose={() => { setShowForm(false); setEditingId(null); }}
          title={editingId ? t("finance.editExpense") : t("finance.addMultiple")}
          wide
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-start gap-2.5 rounded-xl border border-sky-100 bg-sky-50/70 px-3.5 py-3 text-xs leading-relaxed text-sky-800">
              <Receipt size={16} className="mt-0.5 shrink-0" />
              <span>{t("finance.batchHint")}</span>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">
                {t("finance.selectCompany")}<span className="text-red-500 ms-0.5">*</span>
              </label>
              <select
                value={companyId}
                onChange={(e) => changeCompany(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">{t("finance.selectCompany")}</option>
                {companies.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
              {!companyId && <p className="text-xs text-amber-600">{t("finance.selectCompanyFirst")}</p>}
            </div>

            <div className="space-y-3">
              {!editingId && (
                <div className="hidden gap-3 px-1 text-xs font-medium text-slate-500 md:grid md:grid-cols-[1.25fr_0.7fr_1.3fr]">
                  <span>{t("finance.category")}</span>
                  <span>{t("common.amount")}</span>
                  <span>{t("common.description")}</span>
                </div>
              )}

              {rows.map((row, index) => (
                <div key={row.key} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-md bg-white px-1.5 text-[11px] text-slate-500 ring-1 ring-slate-200">{index + 1}</span>
                      {t("finance.rowNumber")}
                    </span>
                    {!editingId && rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeExpenseRow(row.key)}
                        title={t("finance.removeRow")}
                        aria-label={t("finance.removeRow")}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                      >
                        <Trash2 size={13} />{t("common.remove")}
                      </button>
                    )}
                  </div>
                  <div className="grid gap-3 md:grid-cols-[1.25fr_0.7fr_1.3fr]">
                    <SelectWithAdd
                      hideLabel
                      value={row.categoryId}
                      onChange={(value) => selectCategory(row.key, value)}
                      options={formCategoryOptions}
                      placeholder={t("finance.selectCategory")}
                      buttonTitle={t("finance.addCategory")}
                      required
                      disabled={!companyId}
                      quickAddTitle={t("finance.addCategory")}
                      quickAddFields={[
                        { key: "name", label: t("finance.categoryName"), required: true },
                        { key: "companyId", label: t("common.company"), type: "select", required: true, options: companies.map((c) => ({ value: c.id, label: c.name })) },
                      ]}
                      quickAddDefaults={{ companyId }}
                      quickAddEndpoint="/api/expense-categories"
                      onQuickAddSuccess={(item) => {
                        const newCompanyId = item.companyId || companyId;
                        setCategories((prev) => [...prev, { id: item.id, name: item.name, companyId: newCompanyId }]);
                        patchRow(row.key, { categoryId: item.id, category: item.name });
                        toastSuccess(t("common.addedSuccessfully"));
                        notifyDataChanged(["expenses"]);
                      }}
                    />
                    <input
                      type="number"
                      value={row.amount}
                      onChange={(e) => patchRow(row.key, { amount: e.target.value })}
                      placeholder={t("common.amount")}
                      aria-label={t("common.amount")}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                      min="0"
                      step="0.01"
                    />
                    <textarea
                      value={row.description}
                      onChange={(e) => patchRow(row.key, { description: e.target.value })}
                      placeholder={t("common.description")}
                      aria-label={t("common.description")}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={2}
                      required
                    />
                  </div>
                </div>
              ))}
            </div>

            {!editingId && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={addExpenseRow}
                  disabled={rows.length >= MAX_EXPENSE_ROWS}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus size={15} />{t("finance.addRow")}
                </button>
                <span className="text-xs text-slate-400">{t("finance.maxRows")}</span>
              </div>
            )}

            <div className="sticky bottom-0 -mx-5 -mb-5 mt-2 flex flex-col gap-3 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                <span className="text-slate-500">{t("finance.batchCount")}: <strong className="text-slate-800">{rows.length}</strong></span>
                <span className="text-slate-500">{t("finance.batchTotal")}: <strong className="text-slate-900">{batchTotal.toLocaleString("ar-EG")} ج.م</strong></span>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"><X size={16} className="ms-1 inline-block" />{t("common.cancel")}</button>
                <SubmitButton loading={saving} label={t("common.save")} loadingLabel={t("common.saving")} className="bg-blue-600 hover:bg-blue-700 text-white">{editingId ? <Save size={16} /> : <Plus size={16} />}</SubmitButton>
              </div>
            </div>
          </form>
        </FormModal>

        <FormModal open={!!selected} onClose={() => setSelected(null)} title={selected ? t("finance.expenses") : ""} wide>
          {selected && (
            <>
              <div className="mb-4 grid grid-cols-1 gap-3 text-sm text-slate-700 md:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3"><span className="block text-xs text-gray-500">{t("common.date")}</span><span className="mt-1 block font-medium text-slate-800"><DateTimeCell value={selected.date || selected.createdAt} /></span></div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3"><span className="block text-xs text-gray-500">{t("common.company")}</span><span className="mt-1 block font-medium text-slate-800">{selected.company?.name || "—"}</span></div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3"><span className="block text-xs text-gray-500">{t("finance.category")}</span><span className="mt-1 block font-medium text-slate-800">{selected.expenseCategory?.name || selected.category}</span></div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3"><span className="block text-xs text-gray-500">{t("common.amount")}</span><span className="mt-1 block font-bold text-slate-800">{selected.amount.toLocaleString()}</span></div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3"><span className="block text-xs text-gray-500">{t("finance.paidBy")}</span><span className="mt-1 block font-medium text-slate-800">{payerName(selected)}</span></div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 md:col-span-2 xl:col-span-3"><span className="block text-xs text-gray-500">{t("common.description")}</span><span className="mt-1 block font-medium text-slate-800">{selected.description}</span></div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setSelected(null)} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50">{t("common.close")}</button>
                <button onClick={() => openEdit(selected)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700">
                  <Pencil size={14} />{t("common.edit")}
                </button>
                <button onClick={() => handleDelete(selected.id)} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700">
                  <Trash2 size={14} />{t("common.delete")}
                </button>
              </div>
            </>
          )}
        </FormModal>

        <CompanyTabs
          companies={companies}
          value={companyFilter}
          onChange={(v) => { setCompanyFilter(v); setPage(1); }}
        />

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:flex-wrap">
            <div className="w-full md:w-80 md:flex-none"><SearchInput value={search} onChange={setSearch} placeholder={t("finance.searchPlaceholder")} /></div>
            <FilterSelect value={categoryFilter} onChange={(v) => { setCategoryFilter(v); setPage(1); }} options={categoryFilterOptions} allLabel={`${t("finance.categoryFilter")} — ${t("common.all")}`} className="md:w-44" />
            <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={(v) => { setDateFrom(v); setPage(1); }} onToChange={(v) => { setDateTo(v); setPage(1); }} />
            {hasActiveFilters && (
              <button onClick={() => { setSearch(""); setCompanyFilter(""); setCategoryFilter(""); setDateFrom(""); setDateTo(""); }} className="text-sm text-gray-500 hover:text-gray-700 underline">
                {t("common.resetFilters")}
              </button>
            )}
            <div className="flex flex-wrap gap-2 md:ms-auto mt-2 md:mt-0">
              <RefreshButton onRefresh={refresh} refreshing={refreshing} />
              <ExportButton filename="expenses" getExport={exportExpenses} disabled={filtered.length === 0} />
            </div>
          </div>
          {loading ? (
            <div className="flex min-h-[320px] w-full items-center justify-center px-4 py-8">
              <PrinterLoader size="md" label={t("common.loading")} />
            </div>
          ) : expenses.length === 0 ? (
            <div className="flex min-h-[200px] items-center justify-center">
              <p className="text-sm text-gray-400">{t("common.noData")}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[200px] items-center justify-center">
              <p className="text-sm text-gray-400">{t("common.noData")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-start text-sm font-medium text-gray-500">{t("common.date")}</th>
                    <th className="px-4 py-3 text-start text-sm font-medium text-gray-500">{t("finance.category")}</th>
                    <th className="px-4 py-3 text-start text-sm font-medium text-gray-500">{t("common.description")}</th>
                    <th className="px-4 py-3 text-start text-sm font-medium text-gray-500">{t("common.company")}</th>
                    <th className="px-4 py-3 text-start text-sm font-medium text-gray-500">{t("common.amount")}</th>
                    <th className="px-4 py-3 text-start text-sm font-medium text-gray-500">{t("finance.paidBy")}</th>
                    <th className="px-4 py-3 text-start text-sm font-medium text-gray-500">{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {paged.map((expense) => (
                    <tr key={expense.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm"><DateTimeCell value={expense.date || expense.createdAt} /></td>
                      <td className="px-4 py-3 text-sm">{expense.expenseCategory?.name || expense.category}</td>
                      <td className="px-4 py-3 text-sm">{expense.description}</td>
                      <td className="px-4 py-3 text-sm">{expense.company?.name || "—"}</td>
                      <td className="px-4 py-3 text-sm">{expense.amount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm">{payerName(expense)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => setSelected(expense)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100" title={t("common.view")}>
                            <Eye size={14} />{t("common.view")}
                          </button>
                          <button onClick={() => openEdit(expense)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100" title={t("common.edit")}>
                            <Pencil size={14} />{t("common.edit")}
                          </button>
                          <button onClick={() => handleDelete(expense.id)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-100" title={t("common.delete")}>
                            <Trash2 size={14} />{t("common.delete")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} totalItems={filtered.length} pageSize={PAGE_SIZE} />
        </div>
      </div>
    </div>
  );
}
