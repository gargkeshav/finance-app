import { useState } from "react";
import { categoryMemoryKey, debtsOf, linkedBankAmountCents, SELF_ENTITY_ID, validateSpend, type Category, type Entry, type Ledger, type Portion } from "../../domain/ledger";
import { formatAud, isBankDate, parseAud } from "../../domain/value";

interface SpendFormProps {
  ledger: Ledger;
  initialValues?: Partial<Entry>;
  onSave: (entry: Entry) => void;
  onAddCategory?: (category: Category) => void;
  onCancel?: () => void;
}

interface PortionDraft {
  entityId: string;
  amount: string;
}

function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function centsText(cents: number): string {
  return formatAud(cents).slice(4);
}

export function SpendForm({ ledger, initialValues, onSave, onAddCategory, onCancel }: SpendFormProps) {
  const [date, setDate] = useState(initialValues?.date ?? todayLocal());
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [amount, setAmount] = useState(initialValues?.amountCents === undefined ? "" : centsText(initialValues.amountCents));
  const [accountId, setAccountId] = useState(initialValues?.accountId ?? "");
  const [payerEntityId, setPayerEntityId] = useState(initialValues?.payerEntityId ?? SELF_ENTITY_ID);
  const rememberedCategoryId = initialValues?.accountId
    ? ledger.categoryMemory?.find((memory) => memory.key === categoryMemoryKey(initialValues.accountId!, initialValues.description ?? ""))?.categoryId
    : undefined;
  const suggestedCategoryId = rememberedCategoryId;
  const [categoryId, setCategoryId] = useState(initialValues?.categoryId === undefined ? rememberedCategoryId ?? "" : initialValues.categoryId ?? "");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [tagsText, setTagsText] = useState(initialValues?.tags?.join(", ") ?? "");
  const [note, setNote] = useState(initialValues?.note ?? "");
  const [extraReimbursable, setExtraReimbursable] = useState(initialValues?.extraReimbursable ?? false);
  const [portions, setPortions] = useState<PortionDraft[]>(
    initialValues?.portions?.map((portion) => ({ entityId: portion.entityId, amount: centsText(portion.amountCents) })) ?? [],
  );
  const [error, setError] = useState("");

  const selectedAccount = ledger.accounts.find((account) => account.id === accountId);
  const effectivePayerId = selectedAccount?.payerEntityId ?? payerEntityId;
  let amountCents: number | null = null;
  let portionValues: Portion[] = [];
  let remainingCents: number | null = null;
  try {
    amountCents = parseAud(amount);
    portionValues = portions.map((portion) => ({
      entityId: portion.entityId,
      amountCents: parseAud(portion.amount),
    }));
    remainingCents = amountCents - portionValues.reduce((total, portion) => total + portion.amountCents, 0);
  } catch {
    amountCents = null;
  }

  const draft: Entry = {
    id: initialValues?.id ?? "draft",
    kind: initialValues?.kind === "refund" ? "refund" : "spend",
    date,
    description,
    amountCents: amountCents ?? 0,
    payerEntityId: effectivePayerId,
    accountId: accountId || null,
    portions: portionValues,
    refundOf: initialValues?.refundOf,
    bankRowIds: initialValues?.bankRowIds,
    categoryId: categoryId || null,
    tags: tagsText.split(",").map((tag) => tag.trim()).filter(Boolean),
    note,
    extraReimbursable,
    countsTowardDebt: true,
    updatedAt: initialValues?.updatedAt ?? "draft",
  };
  const linkedBankAmount = draft.kind === "spend" ? linkedBankAmountCents(draft, ledger.bankRows ?? []) : null;
  const amountAmended = amountCents !== null && linkedBankAmount !== null && amountCents !== linkedBankAmount;
  const valid = amountCents !== null && isBankDate(date) && validateSpend({ ...draft, kind: "spend" }) && (!amountAmended || note.trim().length > 0);
  const debts = valid ? debtsOf(draft, ledger.bankRows ?? []) : [];
  const firstDebt = debts[0];
  const payerName = ledger.entities.find((entity) => entity.id === effectivePayerId)?.name ?? "Payer";
  const effect = firstDebt
    ? `${ledger.entities.find((entity) => entity.id === (firstDebt.amountCents < 0 ? firstDebt.creditorId : firstDebt.debtorId))?.name ?? "Entity"} will owe ${ledger.entities.find((entity) => entity.id === (firstDebt.amountCents < 0 ? firstDebt.debtorId : firstDebt.creditorId))?.name ?? "entity"} ${formatAud(Math.abs(firstDebt.amountCents))}${debts.length > 1 ? ` and ${debts.length - 1} other debt${debts.length === 2 ? "" : "s"}` : ""}.`
    : valid
      ? "No debts are created by this spend."
      : `${payerName} is the payer; allocations must equal the ${draft.kind === "refund" ? "refund" : "spend"} amount.`;

  function setPortion(index: number, key: keyof PortionDraft, value: string) {
    setPortions((current) => current.map((portion, row) => row === index ? { ...portion, [key]: value } : portion));
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) {
      setError(amountAmended && !note.trim()
        ? "Add a note explaining the amended amount."
        : `Enter a valid date, positive amount, and portions that sum to the ${draft.kind === "refund" ? "refund" : "spend"} amount.`);
      return;
    }
    onSave({
      ...draft,
      id: initialValues?.id ?? crypto.randomUUID(),
      amountCents: amountCents!,
      portions: portionValues,
      updatedAt: initialValues?.updatedAt ?? new Date().toISOString(),
    });
  }

  function addCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    const existing = ledger.categories?.find((category) => category.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setCategoryId(existing.id);
      setNewCategoryName("");
      return;
    }
    const category: Category = { id: crypto.randomUUID(), name, archived: false, updatedAt: new Date().toISOString() };
    onAddCategory?.(category);
    setCategoryId(category.id);
    setNewCategoryName("");
  }

  return (
    <form className="form-grid" onSubmit={save}>
      <label>
        Date
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
      </label>
      <label>
        Description
        <input value={description} onChange={(event) => setDescription(event.target.value)} required />
      </label>
      <label>
        Amount (AUD)
        <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required />
      </label>
      <label>
        Category
        <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="">Uncategorized</option>
          {(ledger.categories ?? []).filter((category) => !category.archived || category.id === categoryId).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
      {categoryId && categoryId === suggestedCategoryId && <p>Suggested from a past spend</p>}
      {onAddCategory && (
        <div className="dialog-actions">
          <label>
            Add category
            <input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} />
          </label>
          <button className="secondary" disabled={!newCategoryName.trim()} onClick={addCategory} type="button">Add category</button>
        </div>
      )}
      <label>
        Tags (comma-separated)
        <input value={tagsText} onChange={(event) => setTagsText(event.target.value)} />
      </label>
      <label>
        Note
        <input value={note} onChange={(event) => setNote(event.target.value)} required={amountAmended} />
      </label>
      {amountAmended && linkedBankAmount !== null && (
        <>
          <p>Entry amount: <span className="amount">{amountCents === null ? "" : formatAud(amountCents)}</span>; bank amount: <span className="amount">{formatAud(linkedBankAmount)}</span></p>
          <label className="checkbox-label">
            <input type="checkbox" checked={extraReimbursable} onChange={(event) => setExtraReimbursable(event.target.checked)} />
            Extra is reimbursable
          </label>
        </>
      )}
      <label>
        Account
        <select
          value={accountId}
          onChange={(event) => {
            const nextAccountId = event.target.value;
            setAccountId(nextAccountId);
            const account = ledger.accounts.find((item) => item.id === nextAccountId);
            if (!nextAccountId || !account) setPayerEntityId(SELF_ENTITY_ID);
            else setPayerEntityId(account.payerEntityId);
          }}
        >
          <option value="">No account</option>
          {ledger.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
      </label>
      {!selectedAccount && (
        <label>
          Payer entity
          <select value={payerEntityId} onChange={(event) => setPayerEntityId(event.target.value)}>
            {ledger.entities.filter((entity) => !entity.archived).map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
          </select>
        </label>
      )}

      <fieldset>
        <legend>Portions</legend>
        {portions.map((portion, index) => (
          <div className="form-grid" key={`${index}-${portion.entityId}`}>
            <label>
              Entity
              <select value={portion.entityId} onChange={(event) => setPortion(index, "entityId", event.target.value)}>
                {ledger.entities.filter((entity) => !entity.archived || entity.id === portion.entityId).map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
              </select>
            </label>
            <label>
              Portion (AUD)
              <input inputMode="decimal" value={portion.amount} onChange={(event) => setPortion(index, "amount", event.target.value)} placeholder="0.00" />
            </label>
            <button className="secondary" onClick={() => setPortions((current) => current.filter((_, row) => row !== index))} type="button">Remove portion</button>
          </div>
        ))}
        {remainingCents !== null && <p>Remaining: <span className="amount">{formatAud(remainingCents)}</span></p>}
        <div className="dialog-actions">
          <button className="secondary" onClick={() => {
            const used = new Set(portions.map((portion) => portion.entityId));
            const next = ledger.entities.find((entity) => !entity.archived && !used.has(entity.id));
            if (next) setPortions((current) => [...current, { entityId: next.id, amount: "" }]);
          }} type="button">Add portion</button>
          <button className="secondary" onClick={() => {
            if (amountCents !== null && amountCents > 0) setPortions([{ entityId: effectivePayerId, amount: centsText(amountCents) }]);
          }} type="button">All to payer</button>
        </div>
      </fieldset>
      <p aria-live="polite">{effect}</p>
      {error && <p className="banner error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="primary" disabled={!valid} type="submit">{draft.kind === "refund" ? "Save refund" : "Save spend"}</button>
        {onCancel && <button className="secondary" onClick={onCancel} type="button">Cancel</button>}
      </div>
    </form>
  );
}