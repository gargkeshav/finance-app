import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileUp,
  X,
} from "lucide-react";
import type { LedgerCommand, Snapshot } from "../application/contracts";
import {
  bankProfileNames,
  type BankPreview,
  type BankProfile,
  type BankObservation,
} from "../application/import-contracts";
import {
  detectBankProfiles,
  MAX_CSV_BYTES,
  parseBankCsv,
} from "../adapters/banks/parse-bank";
import { formatAud } from "../domain/value";
import { rankImportMatches } from "../domain/import-matching";

interface SelectedFile {
  name: string;
  text: string;
  bytes: Uint8Array;
  hash: string;
}

export function ImportDialog({
  snapshot,
  busy,
  pending,
  close,
  save,
}: {
  snapshot: Snapshot;
  busy: boolean;
  pending: boolean;
  close: () => void;
  save: (
    operation?: LedgerCommand["operation"],
    keepImportOpen?: boolean,
  ) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const sequence = useRef(0);
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [queuedFiles, setQueuedFiles] = useState<SelectedFile[]>([]);
  const [profile, setProfile] = useState<BankProfile | "">("");
  const [candidates, setCandidates] = useState<BankProfile[]>([]);
  const [accountId, setAccountId] = useState("");
  const [preview, setPreview] = useState<BankPreview | null>(null);
  const [decisions, setDecisions] = useState<Record<number, string>>({});
  const [retain, setRetain] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      sequence.current += 1;
      element?.close();
      previous?.focus();
    };
  }, []);

  function loadFile(selected: SelectedFile) {
    const detected = detectBankProfiles(selected.text);
    const selectedProfile = detected.length === 1 ? detected[0] : "";
    setFile(selected);
    setCandidates(detected);
    setProfile(selectedProfile);
    setPreview(
      selectedProfile ? parseBankCsv(selected.text, selectedProfile) : null,
    );
    setAccountId("");
    setDecisions({});
    setRetain(false);
    setConfirmed(false);
    setPage(0);
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    const request = ++sequence.current;
    setFile(null);
    setQueuedFiles([]);
    setPreview(null);
    setError("");
    setDecisions({});
    setConfirmed(false);
    setPage(0);
    if (!selected.length) return;
    setReading(true);
    try {
      const loaded: SelectedFile[] = [];
      for (const selectedFile of selected) {
        if (selectedFile.size > MAX_CSV_BYTES)
          throw new Error(`${selectedFile.name} exceeds the 5 MiB limit.`);
        const bytes = new Uint8Array(await selectedFile.arrayBuffer());
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const hash = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
        loaded.push({ name: selectedFile.name, text, bytes, hash });
      }
      if (request !== sequence.current) return;
      loadFile(loaded[0]);
      setQueuedFiles(loaded.slice(1));
    } catch (failure) {
      if (request === sequence.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Unable to read CSV as UTF-8.",
        );
    } finally {
      if (request === sequence.current) setReading(false);
    }
  }

  const exact =
    file && profile
      ? snapshot.imports.find(
          (record) =>
            record.accountId === accountId &&
            record.profile === profile &&
            record.contentHash === file.hash,
        )
      : undefined;
  const rows = preview?.rows ?? [];
  const rankedMatches = rankImportMatches(
    rows,
    accountId,
    profile,
    snapshot.bankEvents,
    snapshot.imports,
  );
  function matches(row: BankObservation) {
    return rankedMatches.get(row.ordinal) ?? [];
  }
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(rows.length / 50) - 1),
  );
  const unresolved = exact
    ? 0
    : rows.filter((row) => matches(row).length && !decisions[row.ordinal])
        .length;
  const chosenExisting = exact
    ? []
    : rows.flatMap((row) =>
        decisions[row.ordinal] && decisions[row.ordinal] !== "new"
          ? [decisions[row.ordinal]]
          : [],
      );
  const repeatedChoice = new Set(chosenExisting).size !== chosenExisting.length;
  const newCount = exact
    ? 0
    : rows.filter(
        (row) => !matches(row).length || decisions[row.ordinal] === "new",
      ).length;

  async function commit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      if (pending) {
        await save();
        return;
      }
      if (
        !file ||
        !profile ||
        !accountId ||
        !confirmed ||
        !preview ||
        preview.issues.length ||
        unresolved ||
        repeatedChoice
      )
        throw new Error(
          "Resolve all blockers and confirm the account/profile before importing.",
        );
      let originalBase64: string | null = exact?.originalBase64 ?? null;
      if (retain && !exact) {
        const chunks: string[] = [];
        for (let offset = 0; offset < file.bytes.length; offset += 8192)
          chunks.push(
            String.fromCharCode(...file.bytes.subarray(offset, offset + 8192)),
          );
        originalBase64 = btoa(chunks.join(""));
      }
      await save(
        {
          type: "commitImport",
          import: {
            id: crypto.randomUUID(),
            accountId,
            profile,
            fileName: file.name,
            contentHash: file.hash,
            headers: preview.headers,
            originalBase64,
            rows: rows.map((row) => {
              const prior = exact?.rows.find(
                (previous) => previous.observation.ordinal === row.ordinal,
              );
              const choice = decisions[row.ordinal];
              return {
                observation: row,
                eventId:
                  prior?.eventId ??
                  (choice && choice !== "new" ? choice : crypto.randomUUID()),
                decision:
                  prior || (choice && choice !== "new") ? "existing" : "new",
                rejectedEventIds:
                  prior?.rejectedEventIds ??
                  (choice === "new"
                    ? matches(row).map((candidate) => candidate.event.id)
                    : []),
              };
            }),
          },
        },
        queuedFiles.length > 0,
      );
      if (queuedFiles.length) {
        const [next, ...remaining] = queuedFiles;
        setQueuedFiles(remaining);
        loadFile(next);
      }
    } catch (failure) {
      setError(
        typeof failure === "string"
          ? failure
          : failure instanceof Error
            ? failure.message
            : "Import failed. No rows were silently skipped.",
      );
    }
  }

  return (
    <dialog
      ref={dialog}
      className="import-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <form onSubmit={commit}>
        <div className="dialog-heading">
          <h2 id={title}>Import bank CSV</h2>
          <button
            type="button"
            className="icon-button"
            title="Close import"
            aria-label="Close import"
            onClick={close}
            disabled={busy || pending}
          >
            <X size={20} />
          </button>
        </div>
        {error && (
          <div className="banner error" role="alert">
            <CircleAlert size={18} />
            <span>{error}</span>
          </div>
        )}
        <fieldset disabled={busy || pending || reading}>
          <label className="file-selection">
            <FileUp size={21} />
            Bank CSV
            <input
              aria-label="Bank CSV"
              type="file"
              accept=".csv,text/csv"
              multiple
              onChange={chooseFile}
            />
          </label>
          <div className="form-grid">
            <label>
              Bank profile
              <select
                value={profile}
                required
                onChange={(event) => {
                  const next = event.target.value as BankProfile | "";
                  setProfile(next);
                  setPreview(
                    file && next ? parseBankCsv(file.text, next) : null,
                  );
                  setDecisions({});
                  setConfirmed(false);
                }}
              >
                <option value="">Confirm bank profile</option>
                {Object.entries(bankProfileNames).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Import account
              <select
                required
                value={accountId}
                onChange={(event) => {
                  setAccountId(event.target.value);
                  setDecisions({});
                  setConfirmed(false);
                }}
              >
                <option value="">Choose account</option>
                {snapshot.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {file && (
            <p className="import-status">
              {file.name} /{" "}
              {candidates.length
                ? candidates
                    .map((candidate) => bankProfileNames[candidate])
                    .join(" or ")
                : "Profile not detected"}
            </p>
          )}
          {file && queuedFiles.length > 0 && (
            <div className="banner">
              {queuedFiles.length + 1} files selected. Each file commits
              independently; completed files stay imported if a later file needs
              attention. {queuedFiles.length} remaining after this file.
            </div>
          )}
          {preview && (
            <>
              {preview.warnings.map((warning) => (
                <p className="import-warning" key={warning}>
                  <CircleAlert size={15} />
                  {warning}
                </p>
              ))}
              {preview.issues.length > 0 && (
                <div className="banner error" role="alert">
                  <div>
                    <strong>{preview.issues.length} blocking issues</strong>
                    <ul>
                      {preview.issues.map((issue, index) => (
                        <li key={index}>
                          {issue.row === null ? "File" : `Row ${issue.row}`}:{" "}
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              {exact && (
                <div className="banner success">
                  <Check size={17} />
                  <span>
                    Exact file already imported for this account/profile. No
                    additional events will be created; this attempt will be
                    audited.
                  </span>
                </div>
              )}
              <div className="import-summary">
                {rows.length} parsed rows / {newCount} new /{" "}
                {exact ? rows.length : chosenExisting.length} linked /{" "}
                {unresolved} awaiting decision
              </div>
              {repeatedChoice && (
                <div className="banner error" role="alert">
                  Two source occurrences cannot link to the same event in one
                  file. Keep legitimate repeated purchases separate.
                </div>
              )}
              <div className="table-scroll import-preview">
                <table>
                  <thead>
                    <tr>
                      <th>Row / date</th>
                      <th>Source description</th>
                      <th className="amount">Bank movement</th>
                      <th>Decision / evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .slice(currentPage * 50, (currentPage + 1) * 50)
                      .map((row) => {
                        const options = matches(row);
                        return (
                          <tr key={row.ordinal}>
                            <td>
                              {row.ordinal}
                              <span className="source-label">{row.date}</span>
                            </td>
                            <td>
                              {row.description}
                              <details>
                                <summary>Raw source fields</summary>
                                <ol>
                                  {row.rawFields.map((field, index) => (
                                    <li key={index}>{field || "(empty)"}</li>
                                  ))}
                                </ol>
                              </details>
                            </td>
                            <td className="amount">
                              {formatAud(row.amountCents)}
                              <span className="source-label">
                                {row.balanceCents === null
                                  ? "No source balance"
                                  : `Balance ${formatAud(row.balanceCents)}`}
                              </span>
                            </td>
                            <td>
                              {exact ? (
                                "Unchanged"
                              ) : !options.length ? (
                                "New occurrence"
                              ) : (
                                <>
                                  <label className="match-label">
                                    Occurrence decision
                                    <select
                                      aria-label={`Occurrence decision for row ${row.ordinal}`}
                                      required
                                      value={decisions[row.ordinal] ?? ""}
                                      onChange={(event) =>
                                        setDecisions((previous) => ({
                                          ...previous,
                                          [row.ordinal]: event.target.value,
                                        }))
                                      }
                                    >
                                      <option value="">
                                        Review possible overlap
                                      </option>
                                      <option value="new">
                                        Keep as distinct new event
                                      </option>
                                      {options.map((candidate) => (
                                        <option
                                          key={candidate.event.id}
                                          value={candidate.event.id}
                                        >
                                          Link {candidate.event.id.slice(0, 8)}/{" "}
                                          {candidate.previouslyRejected
                                            ? "previously kept separate / "
                                            : ""}
                                          {candidate.event.balanceCents === null
                                            ? "unknown balance"
                                            : formatAud(
                                                candidate.event.balanceCents,
                                              )}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  {options.map((candidate) => (
                                    <div
                                      className="match-evidence"
                                      key={candidate.event.id}
                                    >
                                      {candidate.exactSourceFields && (
                                        <span>Raw fields match exactly / </span>
                                      )}
                                      {candidate.previouslyRejected && (
                                        <span>Previously kept separate / </span>
                                      )}
                                      {candidate.balanceEvidence === "same" && (
                                        <span>Balance matches / </span>
                                      )}
                                      {candidate.balanceEvidence ===
                                        "different" && (
                                        <span>Balance differs / </span>
                                      )}
                                      {candidate.matchingNeighbors > 0 && (
                                        <span>
                                          {candidate.matchingNeighbors} adjacent
                                          sequence match(es) /{" "}
                                        </span>
                                      )}
                                      {candidate.event.id.slice(0, 8)} /{" "}
                                      {candidate.event.date} /{" "}
                                      {formatAud(candidate.event.amountCents)} /{" "}
                                      {candidate.event.description} /{" "}
                                      {candidate.event.balanceCents === null
                                        ? "Balance unknown"
                                        : `Balance ${formatAud(candidate.event.balanceCents)}`}
                                    </div>
                                  ))}
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              <div className="pagination">
                <span>
                  {rows.length ? currentPage * 50 + 1 : 0}-
                  {Math.min((currentPage + 1) * 50, rows.length)} of{" "}
                  {rows.length} rows
                </span>
                <button
                  type="button"
                  className="icon-button"
                  title="Previous preview page"
                  aria-label="Previous preview page"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title="Next preview page"
                  aria-label="Next preview page"
                  disabled={(currentPage + 1) * 50 >= rows.length}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  disabled={!!exact}
                  checked={exact ? exact.originalBase64 !== null : retain}
                  onChange={(event) => setRetain(event.target.checked)}
                />
                Retain the original CSV inside unencrypted local data and
                exports.
                {exact ? " Retention is unchanged on an exact retry." : ""}
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I confirm this account, bank profile, and occurrence decisions.
                Commit the entire file atomically.
              </label>
            </>
          )}
        </fieldset>
        {reading && <p role="status">Reading CSV...</p>}
        {pending && (
          <p className="banner error" role="status">
            Import outcome unknown. Retry only the original command.
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            onClick={close}
            disabled={busy || pending}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={
              busy ||
              reading ||
              (!pending &&
                (!rows.length ||
                  !profile ||
                  !accountId ||
                  !confirmed ||
                  !!preview?.issues.length ||
                  unresolved > 0 ||
                  repeatedChoice))
            }
          >
            <Check size={17} />
            {busy
              ? "Importing..."
              : pending
                ? "Retry original command"
                : "Confirm import"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
