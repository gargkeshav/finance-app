import { useState } from "react";
import { categoryMemoryKey, debtsOf, defaultSplitPreset, linkedBankAmountCents, SELF_ENTITY_ID, splitPreset, validateSpend, type Category, type Entity, type Entry, type Ledger, type Portion, type SplitPreset } from "../../domain/ledger";
import { formatAud, formatMoney, isBankDate, parseAud } from "../../domain/value";
import { ComboField } from "./ComboField";

interface SpendFormProps {
  ledger: Ledger;
  initialValues?: Partial<Entry>;
  onSave: (entry: Entry, preset?: SplitPreset) => void;
  onAddCategory?: (category: Category) => void;
  onAddEntity?: (entity: Entity) => void;
  onCancel?: () => void;
}

interface PortionDraft {
  entityId: string;
  amount: string;
  treatment?: Portion["treatment"];
}

function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function centsText(cents: number): string {
  return formatAud(cents).slice(4);
}

export function SpendForm({ ledger, initialValues, onSave, onAddCategory, onAddEntity, onCancel }: SpendFormProps) {
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
  const [tagsText, setTagsText] = useState(initialValues?.tags?.join(", ") ?? "");
  const [note, setNote] = useState(initialValues?.note ?? "");
  const [extraReimbursable, setExtraReimbursable] = useState(initialValues?.extraReimbursable ?? false);
  const [portions, setPortions] = useState<PortionDraft[]>(
    initialValues?.portions?.map((portion) => ({ entityId: portion.entityId, amount: centsText(portion.amountCents), treatment: portion.treatment })) ?? [],
  );
  const [presetEntityId, setPresetEntityId] = useState(initialValues?.portions?.[0]?.entityId ?? initialValues?.payerEntityId ?? SELF_ENTITY_ID);
  const [equalEntityIds, setEqualEntityIds] = useState(initialValues?.portions?.map((portion) => portion.entityId) ?? []);
  const [activePreset, setActivePreset] = useState<SplitPreset | undefined>();
  const [error, setError] = useState("");

  const selectedAccount = ledger.accounts.find((account) => account.id === accountId);
  const effectivePayerId = selectedAccount?.payerEntityId ?? payerEntityId;
  const selectedEntityIds = [effectivePayerId, presetEntityId, ...portions.map((portion) => portion.entityId)];
  const entityOptions = ledger.entities
    .filter((entity) => !entity.archived || selectedEntityIds.includes(entity.id))
    .map((entity) => ({ id: entity.id, name: entity.name }));
  let amountCents: number | null = null;
  let portionValues: Portion[] = [];
  let remainingCents: number | null = null;
  try {
    amountCents = parseAud(amount);
    portionValues = portions.map((portion) => ({
      entityId: portion.entityId,
      amountCents: parseAud(portion.amount),
      ...(portion.treatment && portion.treatment !== "claim" ? { treatment: portion.treatment } : {}),
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
  const payerName = ledger.entities.find((entity) => entity.id === effectivePayerId)?.name ?? "Unknown";
  const debtorId = firstDebt ? (firstDebt.amountCents < 0 ? firstDebt.creditorId : firstDebt.debtorId) : "";
  const creditorId = firstDebt ? (firstDebt.amountCents < 0 ? firstDebt.debtorId : firstDebt.creditorId) : "";
  const debtor = ledger.entities.find((entity) => entity.id === debtorId);
  const creditor = ledger.entities.find((entity) => entity.id === creditorId);
  const effect = firstDebt && debtor && creditor
    ? { kind: "debt" as const, debtor, creditor, amount: formatMoney(Math.abs(firstDebt.amountCents)), more: debts.length - 1 }
    : valid
      ? { kind: "none" as const }
      : { kind: "incomplete" as const };

  function setPortion(index: number, key: keyof PortionDraft, value: string) {
    setActivePreset(undefined);
    setPortions((current) => current.map((portion, row) => row === index ? { ...portion, [key]: value } : portion));
  }

  function setPortionTreatment(index: number, value: NonNullable<Portion["treatment"]>) {
    setActivePreset(undefined);
    setPortions((current) => current.map((portion, row) => row === index
      ? { ...portion, treatment: value === "claim" ? undefined : value }
      : portion));
  }

  function applyPreset(preset: SplitPreset) {
    if (amountCents === null || amountCents <= 0) return;
    try {
      setPortions(splitPreset(amountCents, effectivePayerId, preset).map((portion) => ({
        entityId: portion.entityId,
        amount: centsText(portion.amountCents),
      })));
      setActivePreset(preset);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The split preset could not be applied.");
    }
  }

  function handleFormKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel?.();
    } else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) {
      setError(amountAmended && !note.trim()
        ? "Add a note explaining the amended amount."
        : `Enter a valid date, positive amount, and split that sums to the ${draft.kind === "refund" ? "refund" : "spend"} amount.`);
      return;
    }
    onSave({
      ...draft,
      id: initialValues?.id ?? crypto.randomUUID(),
      amountCents: amountCents!,
      portions: portionValues,
      updatedAt: initialValues?.updatedAt ?? new Date().toISOString(),
    }, activePreset);
  }

  function createCategory(name: string): string {
    const category: Category = { id: crypto.randomUUID(), name, archived: false, updatedAt: new Date().toISOString() };
    onAddCategory?.(category);
    return category.id;
  }

  function createEntity(name: string): string {
    const entity: Entity = { id: crypto.randomUUID(), kind: "person", name, archived: false, updatedAt: new Date().toISOString() };
    onAddEntity?.(entity);
    return entity.id;
  }

  return (
    <form className="form-grid" onKeyDown={handleFormKeyDown} onSubmit={save}>
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
      <ComboField label="Category" value={categoryId} options={(ledger.categories ?? [])
        .filter((category) => !category.archived || category.id === categoryId)
        .map((category) => ({ id: category.id, name: category.name }))}
        nonePlaceholder="Uncategorized" onChange={setCategoryId}
        onCreate={onAddCategory ? createCategory : undefined} />
      {categoryId && categoryId === suggestedCategoryId && <p>Suggested from a past spend</p>}
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
                    <p>Entry amount: <span className="amount">{amountCents === null ? "" : formatMoney(amountCents)}</span>; bank amount: <span className="amount">{formatMoney(linkedBankAmount)}</span></p>
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
        <ComboField label="Paid by" value={payerEntityId} options={entityOptions}
          nonePlaceholder="Choose payer" onChange={setPayerEntityId}
          onCreate={onAddEntity ? createEntity : undefined} />
      )}

      <fieldset>
        <legend>Split</legend>
        <div className="dialog-actions" aria-label="Split presets">
          <button className="secondary" disabled={amountCents === null || amountCents <= 0} onClick={() => applyPreset({ kind: "payer" })} type="button">Payer</button>
          <button className="secondary" disabled={amountCents === null || amountCents <= 0} onClick={() => applyPreset({ kind: "halfHouse" })} type="button">Half House</button>
          <button className="secondary" disabled={amountCents === null || amountCents <= 0} onClick={() => applyPreset({ kind: "allHouse" })} type="button">All House</button>
          {ledger.entities.some((entity) => !entity.archived) && <>
            <ComboField label="Entity" value={presetEntityId} options={entityOptions}
              nonePlaceholder="Choose entity" onChange={(entityId) => {
                setPresetEntityId(entityId);
                if (initialValues?.id || portions.length > 0 || amountCents === null || amountCents <= 0) return;
                const entity = ledger.entities.find((candidate) => candidate.id === entityId);
                if (entity?.kind !== "group" && entity?.kind !== "house") return;
                const preset = defaultSplitPreset(entity, amountCents);
                if (preset) applyPreset(preset);
              }}
              onCreate={onAddEntity ? createEntity : undefined} />
            <button className="secondary" disabled={amountCents === null || amountCents <= 0} onClick={() => applyPreset({ kind: "entity", entityId: presetEntityId })} type="button">All to entity</button>
          </>}
          <label>
            Equal split entities
            <select multiple size={Math.min(4, Math.max(2, ledger.entities.filter((entity) => !entity.archived).length))} value={equalEntityIds} onChange={(event) => setEqualEntityIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>
              {ledger.entities.filter((entity) => !entity.archived || equalEntityIds.includes(entity.id)).map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
            </select>
          </label>
          <button className="secondary" disabled={amountCents === null || amountCents <= 0 || equalEntityIds.length === 0} onClick={() => applyPreset({ kind: "equal", entityIds: equalEntityIds })} type="button">Equal split</button>
          {accountId && ledger.lastSplitByAccount?.[accountId] && <button className="secondary" disabled={amountCents === null || amountCents <= 0} onClick={() => applyPreset(ledger.lastSplitByAccount![accountId])} type="button">Last split on this account</button>}
        </div>
        {portions.map((portion, index) => (
          <div className="form-grid" key={`${index}-${portion.entityId}`}>
            <ComboField label="For" value={portion.entityId} options={entityOptions}
              nonePlaceholder="Choose person" onChange={(id) => setPortion(index, "entityId", id)}
              onCreate={onAddEntity ? createEntity : undefined} />
            <label>
              Amount
              <input inputMode="decimal" value={portion.amount} onChange={(event) => setPortion(index, "amount", event.target.value)} placeholder="0.00" />
            </label>
            <label>
              Treatment
              <select value={portion.treatment ?? "claim"} onChange={(event) => setPortionTreatment(index, event.target.value as NonNullable<Portion["treatment"]>)}>
                <option value="claim">Claim</option>
                <option value="writeOff">Write off</option>
                <option value="gift">Gift</option>
                <option value="reportOnly">Report only</option>
              </select>
            </label>
            <button aria-label={`Remove ${ledger.entities.find((entity) => entity.id === portion.entityId)?.name ?? "split"}`} className="icon-button" onClick={() => { setActivePreset(undefined); setPortions((current) => current.filter((_, row) => row !== index)); }} type="button">×</button>
          </div>
        ))}
        {remainingCents !== null && <p className={remainingCents === 0 ? "amount positive" : "banner warning"}>Left to split: {formatMoney(remainingCents)}</p>}
        <div className="dialog-actions">
          <button className="secondary" onClick={() => {
            const used = new Set(portions.map((portion) => portion.entityId));
            const next = ledger.entities.find((entity) => !entity.archived && entity.kind !== "self" && entity.kind !== "house" && !used.has(entity.id));
            if (next) {
              setActivePreset(undefined);
              setPortions((current) => [...current, { entityId: next.id, amount: "" }]);
            }
          }} type="button">Add person</button>
          <button className="secondary" onClick={() => {
            if (amountCents !== null && amountCents > 0) applyPreset({ kind: "payer" });
            }} type="button">All to {effectivePayerId === "self" ? "You" : payerName}</button>
        </div>
      </fieldset>
      <p aria-live="polite">
        {effect.kind === "debt" ? <>
          {effect.debtor.id === "self" ? "You owe " : <><span className={`allocation-tag${effect.debtor.kind === "house" ? " house" : ""}`}>{effect.debtor.name}</span> owes </>}
          {effect.creditor.id === "self" ? "you" : <span className={`allocation-tag${effect.creditor.kind === "house" ? " house" : ""}`}>{effect.creditor.name}</span>} {effect.amount}
          {effect.more > 0 && ` and ${effect.more} other debt${effect.more === 1 ? "" : "s"}`}
        </> : effect.kind === "none" ? "No debts are created by this spend." : `${effectivePayerId === "self" ? "You paid" : `Paid by ${payerName}`}. Split the full amount.`}
      </p>
      {error && <p className="banner error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="primary" disabled={!valid} type="submit">{draft.kind === "refund" ? "Save refund" : "Save spend"}</button>
        {onCancel && <button className="secondary" onClick={onCancel} type="button">Cancel</button>}
      </div>
    </form>
  );
}