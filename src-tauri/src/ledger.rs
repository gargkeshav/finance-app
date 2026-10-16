use base64::Engine;
use chrono::{Datelike, NaiveDate};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX_CENTS: i64 = 9_007_199_254_740_991;
type LedgerResult<T> = Result<T, String>;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Account {
    id: String,
    name: String,
    kind: String,
    role: String,
    currency: String,
    opening_balance_cents: Option<i64>,
    opening_date: Option<String>,
    version: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Allocation {
    id: String,
    bucket: String,
    person_id: Option<String>,
    amount_cents: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Expense {
    id: String,
    account_id: String,
    date: String,
    description: String,
    currency: String,
    amount_cents: i64,
    allocations: Vec<Allocation>,
    version: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum Operation {
    #[serde(rename = "commitImport")]
    CommitImport { import: BankImport },
    #[serde(rename = "createAccount")]
    CreateAccount { account: Account },
    #[serde(rename = "createExpense")]
    CreateExpense { expense: Expense },
    #[serde(rename = "reverseExpense", rename_all = "camelCase")]
    ReverseExpense { expense_id: String, reason: String },
    #[serde(rename = "correctExpense", rename_all = "camelCase")]
    CorrectExpense {
        expense_id: String,
        reason: String,
        replacement: Expense,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Command {
    command_id: String,
    #[serde(default)]
    expected_epoch: String,
    expected_revision: i64,
    operation: Operation,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    schema_version: i64,
    epoch: String,
    revision: i64,
    accounts: Vec<Account>,
    expenses: Vec<Expense>,
    #[serde(default)]
    imports: Vec<BankImport>,
    #[serde(default)]
    bank_events: Vec<BankEvent>,
    #[serde(default)]
    reversals: Vec<Reversal>,
    audit_count: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    ordinal: i64,
    raw_fields: Vec<String>,
    date: String,
    description: String,
    comparison_description: String,
    amount_cents: i64,
    balance_cents: Option<i64>,
    currency: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportRow {
    observation: Observation,
    event_id: String,
    decision: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BankImport {
    id: String,
    account_id: String,
    profile: String,
    file_name: String,
    content_hash: String,
    headers: Option<Vec<String>>,
    original_base64: Option<String>,
    rows: Vec<ImportRow>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BankEvent {
    id: String,
    account_id: String,
    date: String,
    description: String,
    comparison_description: String,
    amount_cents: i64,
    balance_cents: Option<i64>,
    currency: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Reversal {
    expense_id: String,
    reason: String,
}

pub struct Store {
    connection: Connection,
    path: PathBuf,
}

pub const MAX_EXPORT_BYTES: usize = 32 * 1024 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuditEvidence {
    request: String,
    created_at: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecoveryEvidence {
    id: String,
    prior_epoch: String,
    imported_epoch: String,
    created_at: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExportDocument {
    format_version: u32,
    schema_version: u32,
    unencrypted: bool,
    snapshot: Snapshot,
    audit: Vec<AuditEvidence>,
    recovery: Vec<RecoveryEvidence>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub snapshot: Snapshot,
    pub safety_file: String,
}

fn storage_error(_: impl std::fmt::Display) -> String {
    "Storage operation failed. The command outcome must be checked before retrying.".to_owned()
}

fn valid_id(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| {
        id.to_string() == value
            && id.get_version_num() == 4
            && id.get_variant() == uuid::Variant::RFC4122
    })
}

fn valid_date(value: &str) -> bool {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok_and(|date| {
        (1900..=9999).contains(&date.year()) && date.format("%Y-%m-%d").to_string() == value
    })
}

fn valid_text(value: &str, limit: usize) -> bool {
    !value.is_empty() && value.trim() == value && value.chars().count() <= limit
}

fn validate(command: &Command) -> LedgerResult<()> {
    let valid = valid_id(&command.command_id)
        && valid_id(&command.expected_epoch)
        && (0..MAX_CENTS).contains(&command.expected_revision)
        && match &command.operation {
            Operation::CommitImport { import } => {
                let unique_events: HashSet<_> =
                    import.rows.iter().map(|row| &row.event_id).collect();
                let unique_rows: HashSet<_> = import
                    .rows
                    .iter()
                    .map(|row| row.observation.ordinal)
                    .collect();
                valid_id(&import.id)
                    && valid_id(&import.account_id)
                    && ["ing", "hsbc", "anz-credit", "anz-transaction"]
                        .contains(&import.profile.as_str())
                    && valid_text(&import.file_name, 255)
                    && import.content_hash.len() == 64
                    && import
                        .content_hash
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                    && (1..=10_000).contains(&import.rows.len())
                    && unique_events.len() == import.rows.len()
                    && unique_rows.len() == import.rows.len()
                    && import
                        .rows
                        .windows(2)
                        .all(|rows| rows[0].observation.ordinal < rows[1].observation.ordinal)
                    && import.rows.iter().all(|row| {
                        let source = &row.observation;
                        valid_id(&row.event_id)
                            && ["new", "existing"].contains(&row.decision.as_str())
                            && source.ordinal > 0
                            && valid_date(&source.date)
                            && source.currency == "AUD"
                            && (-MAX_CENTS..=MAX_CENTS).contains(&source.amount_cents)
                            && source
                                .balance_cents
                                .is_none_or(|amount| (-MAX_CENTS..=MAX_CENTS).contains(&amount))
                            && (1..=50).contains(&source.raw_fields.len())
                    })
                    && import.original_base64.as_ref().is_none_or(|encoded| {
                        encoded.len() <= 7_000_000
                            && base64::engine::general_purpose::STANDARD
                                .decode(encoded)
                                .is_ok_and(|bytes| {
                                    bytes.len() <= 5 * 1024 * 1024
                                        && format!("{:x}", Sha256::digest(&bytes))
                                            == import.content_hash
                                })
                    })
                    && serde_json::to_vec(import).is_ok_and(|bytes| bytes.len() <= 16 * 1024 * 1024)
            }
            Operation::ReverseExpense { expense_id, reason } => {
                valid_id(expense_id) && valid_text(reason, 300)
            }
            Operation::CreateAccount { account } => {
                valid_id(&account.id)
                    && valid_text(&account.name, 100)
                    && ["asset", "credit"].contains(&account.kind.as_str())
                    && ["personal", "common"].contains(&account.role.as_str())
                    && account.currency == "AUD"
                    && account.version == 1
                    && match (account.opening_balance_cents, &account.opening_date) {
                        (None, None) => true,
                        (Some(amount), Some(date)) => {
                            (-MAX_CENTS..=MAX_CENTS).contains(&amount) && valid_date(date)
                        }
                        _ => false,
                    }
            }
            Operation::CreateExpense { expense }
            | Operation::CorrectExpense {
                replacement: expense,
                ..
            } => {
                let total = expense
                    .allocations
                    .iter()
                    .try_fold(0i64, |sum, line| sum.checked_add(line.amount_cents));
                valid_id(&expense.id)
                    && valid_id(&expense.account_id)
                    && valid_date(&expense.date)
                    && valid_text(&expense.description, 300)
                    && expense.currency == "AUD"
                    && expense.version == 1
                    && (1..=MAX_CENTS).contains(&expense.amount_cents)
                    && (1..=100).contains(&expense.allocations.len())
                    && total == Some(expense.amount_cents)
                    && expense.allocations.iter().all(|line| {
                        valid_id(&line.id)
                            && (1..=MAX_CENTS).contains(&line.amount_cents)
                            && match line.bucket.as_str() {
                                "personal" | "house" => line.person_id.is_none(),
                                _ => false,
                            }
                    })
            }
        };
    let valid = valid
        && match &command.operation {
            Operation::CorrectExpense {
                expense_id,
                reason,
                replacement,
            } => valid_id(expense_id) && valid_text(reason, 300) && replacement.id != *expense_id,
            _ => true,
        };
    if valid {
        Ok(())
    } else {
        Err("Invalid command. Check amounts, dates, and supported fields.".to_owned())
    }
}

impl Store {
    pub fn open(path: &Path) -> LedgerResult<Self> {
        let mut connection = Connection::open(path).map_err(storage_error)?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(storage_error)?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(storage_error)?;
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(storage_error)?;
        if version > 3 {
            return Err("This database requires a newer app. It was not modified.".to_owned());
        }
        if version == 0 {
            let transaction = connection.transaction().map_err(storage_error)?;
            transaction.execute_batch(
                "CREATE TABLE ledger_state (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL CHECK(revision >= 0));
                 INSERT INTO ledger_state VALUES(1, 0);
                 CREATE TABLE accounts (id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)));
                 CREATE TABLE expenses (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), amount_cents INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents <= 9007199254740991), payload TEXT NOT NULL CHECK(json_valid(payload)));
                 CREATE TABLE allocations (id TEXT PRIMARY KEY, expense_id TEXT NOT NULL REFERENCES expenses(id), bucket TEXT NOT NULL CHECK(bucket IN ('personal', 'house')), amount_cents INTEGER NOT NULL CHECK(amount_cents > 0));
                 CREATE TABLE funding (expense_id TEXT PRIMARY KEY REFERENCES expenses(id), account_id TEXT NOT NULL REFERENCES accounts(id), amount_cents INTEGER NOT NULL CHECK(amount_cents > 0));
                 CREATE TABLE audit (command_id TEXT PRIMARY KEY, revision INTEGER NOT NULL UNIQUE, request TEXT NOT NULL CHECK(json_valid(request)), created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
                 PRAGMA user_version = 1;"
            ).map_err(storage_error)?;
            transaction.commit().map_err(storage_error)?;
        }
        if version < 2 {
            let transaction = connection.transaction().map_err(storage_error)?;
            transaction.execute_batch("ALTER TABLE ledger_state ADD COLUMN epoch TEXT; CREATE TABLE recovery_log (id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload))); PRAGMA user_version = 2;").map_err(storage_error)?;
            transaction
                .execute(
                    "UPDATE ledger_state SET epoch = ?1 WHERE id = 1",
                    [Uuid::new_v4().to_string()],
                )
                .map_err(storage_error)?;
            transaction.commit().map_err(storage_error)?;
        }
        if version < 3 {
            let transaction = connection.transaction().map_err(storage_error)?;
            transaction.execute_batch(
                "CREATE TABLE bank_events (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), payload TEXT NOT NULL CHECK(json_valid(payload)));
                 CREATE TABLE bank_imports (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), profile TEXT NOT NULL, content_hash TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), UNIQUE(account_id,profile,content_hash));
                 PRAGMA user_version = 3;"
            ).map_err(storage_error)?;
            transaction.commit().map_err(storage_error)?;
        }
        Ok(Self {
            connection,
            path: path.to_owned(),
        })
    }

    pub fn read(&self) -> LedgerResult<Snapshot> {
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(storage_error)?;
        let snapshot = read_snapshot(&transaction)?;
        transaction.commit().map_err(storage_error)?;
        Ok(snapshot)
    }

    pub fn export_json(&self) -> LedgerResult<String> {
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(storage_error)?;
        let output = serialize_export(&transaction)?;
        transaction.commit().map_err(storage_error)?;
        Ok(output)
    }

    pub fn export_to(&self, path: &Path) -> LedgerResult<()> {
        let data_folder = self
            .path
            .parent()
            .ok_or("Data folder is unavailable.")?
            .canonicalize()
            .map_err(storage_error)?;
        let destination_folder = path
            .parent()
            .ok_or("Export folder is unavailable.")?
            .canonicalize()
            .map_err(storage_error)?;
        if destination_folder.starts_with(&data_folder)
            || path
                .canonicalize()
                .is_ok_and(|target| target.starts_with(&data_folder))
        {
            return Err("Choose an export location outside the live app data folder.".to_owned());
        }
        write_export(path, &self.export_json()?)
    }

    pub fn restore_json(
        &mut self,
        text: &str,
        expected_epoch: &str,
        expected_revision: i64,
    ) -> LedgerResult<RestoreResult> {
        let original = self.read()?;
        if original.epoch != expected_epoch || original.revision != expected_revision {
            return Err("The ledger changed. Reload and review the restore again.".to_owned());
        }
        if text.len() > MAX_EXPORT_BYTES {
            return Err("Export exceeds the 32 MiB limit.".to_owned());
        }
        let mut document: ExportDocument =
            serde_json::from_str(text).map_err(|_| "Invalid or incomplete export.".to_owned())?;
        if document.format_version != 1
            || ![2, 3].contains(&document.schema_version)
            || document.snapshot.schema_version != i64::from(document.schema_version)
            || !document.unencrypted
            || !valid_id(&document.snapshot.epoch)
        {
            return Err(
                "Unsupported export version or format. Existing data was not changed.".to_owned(),
            );
        }
        document.snapshot.schema_version = 3;
        let folder = self.path.parent().ok_or("Data folder is unavailable.")?;
        let staging = tempfile::tempdir_in(folder).map_err(storage_error)?;
        let mut staged = Store::open(&staging.path().join("staged.sqlite3"))?;
        for entry in document.audit {
            if chrono::DateTime::parse_from_rfc3339(&entry.created_at).is_err() {
                return Err("Invalid audit timestamp.".to_owned());
            }
            let mut command: Command = serde_json::from_str(&entry.request)
                .map_err(|_| "Invalid audit evidence.".to_owned())?;
            let original: serde_json::Value =
                serde_json::from_str(&entry.request).map_err(storage_error)?;
            if original.get("expectedEpoch").is_some() && !valid_id(&command.expected_epoch) {
                return Err("Invalid original audit epoch.".to_owned());
            }
            if command.expected_revision != staged.read()?.revision {
                return Err("Audit history is incomplete or out of order.".to_owned());
            }
            command.expected_epoch = staged.read()?.epoch;
            let command_id = command.command_id.clone();
            staged.execute(command)?;
            staged
                .connection
                .execute(
                    "UPDATE audit SET request = ?1, created_at = ?2 WHERE command_id = ?3",
                    params![entry.request, entry.created_at, command_id],
                )
                .map_err(storage_error)?;
        }
        for entry in document.recovery {
            if !valid_id(&entry.id)
                || !valid_id(&entry.prior_epoch)
                || !valid_id(&entry.imported_epoch)
                || chrono::DateTime::parse_from_rfc3339(&entry.created_at).is_err()
            {
                return Err("Invalid recovery evidence.".to_owned());
            }
            staged
                .connection
                .execute(
                    "INSERT INTO recovery_log(id,payload) VALUES(?1,?2)",
                    params![
                        entry.id,
                        serde_json::to_string(&entry).map_err(storage_error)?
                    ],
                )
                .map_err(storage_error)?;
        }
        staged
            .connection
            .execute(
                "UPDATE ledger_state SET epoch = ?1 WHERE id = 1",
                [&document.snapshot.epoch],
            )
            .map_err(storage_error)?;
        if serde_json::to_value(staged.read()?).map_err(storage_error)?
            != serde_json::to_value(&document.snapshot).map_err(storage_error)?
        {
            return Err("Export records do not reconcile to their audit evidence.".to_owned());
        }
        let imported_epoch = document.snapshot.epoch;
        let epoch = Uuid::new_v4().to_string();
        staged
            .connection
            .execute("UPDATE ledger_state SET epoch = ?1 WHERE id = 1", [&epoch])
            .map_err(storage_error)?;
        let evidence = RecoveryEvidence {
            id: Uuid::new_v4().to_string(),
            prior_epoch: original.epoch,
            imported_epoch,
            created_at: staged
                .connection
                .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
                    row.get(0)
                })
                .map_err(storage_error)?,
        };
        staged
            .connection
            .execute(
                "INSERT INTO recovery_log(id,payload) VALUES(?1,?2)",
                params![
                    evidence.id,
                    serde_json::to_string(&evidence).map_err(storage_error)?
                ],
            )
            .map_err(storage_error)?;
        serialize_export(&staged.connection)?;
        let safety_file = format!("recovery-safety-{}.finance.json", Uuid::new_v4());
        write_export(&folder.join(&safety_file), &self.export_json()?)?;
        let snapshot = staged.read()?;
        self.connection
            .execute(
                "ATTACH DATABASE ?1 AS restored",
                [staged.path.to_str().ok_or("Staging path is unavailable.")?],
            )
            .map_err(storage_error)?;
        let applied = (|| -> LedgerResult<()> {
            let transaction = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(storage_error)?;
            let current = read_snapshot(&transaction)?;
            if current.epoch != expected_epoch || current.revision != expected_revision {
                return Err("The ledger changed. Restore was not applied.".to_owned());
            }
            transaction.execute_batch(
                "DELETE FROM allocations; DELETE FROM funding; DELETE FROM expenses; DELETE FROM bank_imports; DELETE FROM bank_events; DELETE FROM accounts; DELETE FROM audit; DELETE FROM recovery_log;
                 INSERT INTO accounts SELECT * FROM restored.accounts;
                 INSERT INTO bank_events SELECT * FROM restored.bank_events;
                 INSERT INTO bank_imports SELECT * FROM restored.bank_imports;
                 INSERT INTO expenses SELECT * FROM restored.expenses;
                 INSERT INTO allocations SELECT * FROM restored.allocations;
                 INSERT INTO funding SELECT * FROM restored.funding;
                 INSERT INTO audit SELECT * FROM restored.audit;
                 INSERT INTO recovery_log SELECT * FROM restored.recovery_log;
                 UPDATE ledger_state SET revision = (SELECT revision FROM restored.ledger_state WHERE id = 1), epoch = (SELECT epoch FROM restored.ledger_state WHERE id = 1) WHERE id = 1;"
            ).map_err(storage_error)?;
            transaction.commit().map_err(storage_error)?;
            Ok(())
        })();
        let detached = self.connection.execute_batch("DETACH DATABASE restored");
        if detached.is_err() && applied.is_err() {
            return Err("Restore was not applied. Restart the app before retrying.".to_owned());
        }
        applied?;
        Ok(RestoreResult {
            snapshot,
            safety_file,
        })
    }

    pub fn resolve(&self, command: Command) -> LedgerResult<Option<Snapshot>> {
        validate(&command)?;
        let request = serde_json::to_string(&command).map_err(storage_error)?;
        let previous: Option<String> = self
            .connection
            .query_row(
                "SELECT request FROM audit WHERE command_id = ?1",
                [&command.command_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(storage_error)?;
        match previous {
            None => Ok(None),
            Some(previous) if previous == request => self.read().map(Some),
            _ => Err("Command identity conflict. Reload before retrying.".to_owned()),
        }
    }

    pub fn execute(&mut self, command: Command) -> LedgerResult<Snapshot> {
        validate(&command)?;
        let request = serde_json::to_string(&command).map_err(storage_error)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        let previous: Option<String> = transaction
            .query_row(
                "SELECT request FROM audit WHERE command_id = ?1",
                [&command.command_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(storage_error)?;
        if let Some(previous) = previous {
            if previous != request {
                return Err("Command identity conflict. Reload before retrying.".to_owned());
            }
            transaction.commit().map_err(storage_error)?;
            return self.read();
        }
        let revision: i64 = transaction
            .query_row(
                "SELECT revision FROM ledger_state WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .map_err(storage_error)?;
        let epoch: String = transaction
            .query_row("SELECT epoch FROM ledger_state WHERE id = 1", [], |row| {
                row.get(0)
            })
            .map_err(storage_error)?;
        if epoch != command.expected_epoch || revision != command.expected_revision {
            return Err("The ledger changed. Reload and review before saving again.".to_owned());
        }
        match &command.operation {
            Operation::CommitImport { import } => {
                let account_exists: bool = transaction
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1)",
                        [&import.account_id],
                        |row| row.get(0),
                    )
                    .map_err(storage_error)?;
                if !account_exists {
                    return Err("Import account not found.".to_owned());
                }
                let exact: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM bank_imports WHERE account_id = ?1 AND profile = ?2 AND content_hash = ?3)", params![import.account_id, import.profile, import.content_hash], |row| row.get(0)).map_err(storage_error)?;
                if !exact {
                    for row in &import.rows {
                        let source = &row.observation;
                        if row.decision == "existing" {
                            let payload: Option<String> = transaction
                                .query_row(
                                    "SELECT payload FROM bank_events WHERE id = ?1",
                                    [&row.event_id],
                                    |record| record.get(0),
                                )
                                .optional()
                                .map_err(storage_error)?;
                            let event: BankEvent = serde_json::from_str(
                                &payload.ok_or("Selected match no longer exists.")?,
                            )
                            .map_err(storage_error)?;
                            if event.account_id != import.account_id
                                || event.date != source.date
                                || event.amount_cents != source.amount_cents
                                || event.comparison_description != source.comparison_description
                            {
                                return Err(
                                    "Selected match is no longer compatible. Reload the preview."
                                        .to_owned(),
                                );
                            }
                        } else {
                            let event = BankEvent {
                                id: row.event_id.clone(),
                                account_id: import.account_id.clone(),
                                date: source.date.clone(),
                                description: source.description.clone(),
                                comparison_description: source.comparison_description.clone(),
                                amount_cents: source.amount_cents,
                                balance_cents: source.balance_cents,
                                currency: source.currency.clone(),
                            };
                            transaction.execute("INSERT INTO bank_events(id,account_id,payload) VALUES(?1,?2,?3)", params![event.id, event.account_id, serde_json::to_string(&event).map_err(storage_error)?]).map_err(storage_error)?;
                        }
                    }
                    transaction.execute("INSERT INTO bank_imports(id,account_id,profile,content_hash,payload) VALUES(?1,?2,?3,?4,?5)", params![import.id, import.account_id, import.profile, import.content_hash, serde_json::to_string(import).map_err(storage_error)?]).map_err(storage_error)?;
                }
            }
            Operation::ReverseExpense { expense_id, .. }
            | Operation::CorrectExpense { expense_id, .. } => {
                let exists: bool = transaction
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM expenses WHERE id = ?1)",
                        [expense_id],
                        |row| row.get(0),
                    )
                    .map_err(storage_error)?;
                if !exists {
                    return Err("Expense not found.".to_owned());
                }
                let reversed: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM audit WHERE json_extract(request, '$.operation.type') IN ('reverseExpense','correctExpense') AND json_extract(request, '$.operation.expenseId') = ?1)", [expense_id], |row| row.get(0)).map_err(storage_error)?;
                if reversed {
                    return Err("Expense is already reversed.".to_owned());
                }
                if let Operation::CorrectExpense { replacement, .. } = &command.operation {
                    insert_expense(&transaction, replacement)?;
                }
            }
            Operation::CreateAccount { account } => {
                transaction
                    .execute(
                        "INSERT INTO accounts(id, payload) VALUES(?1, ?2)",
                        params![
                            account.id,
                            serde_json::to_string(account).map_err(storage_error)?
                        ],
                    )
                    .map_err(storage_error)?;
            }
            Operation::CreateExpense { expense } => {
                insert_expense(&transaction, expense)?;
            }
        }
        transaction
            .execute(
                "INSERT INTO audit(command_id, revision, request) VALUES(?1, ?2, ?3)",
                params![command.command_id, revision + 1, request],
            )
            .map_err(storage_error)?;
        transaction
            .execute(
                "UPDATE ledger_state SET revision = ?1 WHERE id = 1",
                [revision + 1],
            )
            .map_err(storage_error)?;
        serialize_export(&transaction)?;
        transaction.commit().map_err(storage_error)?;
        self.read()
    }
}

fn serialize_export(connection: &Connection) -> LedgerResult<String> {
    let snapshot = read_snapshot(connection)?;
    let audit = {
        let mut statement = connection
            .prepare("SELECT request, created_at FROM audit ORDER BY revision")
            .map_err(storage_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok(AuditEvidence {
                    request: row.get(0)?,
                    created_at: row.get(1)?,
                })
            })
            .map_err(storage_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(storage_error)?
    };
    let recovery = read_payloads(
        connection,
        "SELECT payload FROM recovery_log ORDER BY rowid",
    )?;
    let output = serde_json::to_string_pretty(&ExportDocument {
        format_version: 1,
        schema_version: 3,
        unencrypted: true,
        snapshot,
        audit,
        recovery,
    })
    .map_err(storage_error)?;
    if output.len() > MAX_EXPORT_BYTES {
        return Err("This change exceeds the version's 32 MiB complete-export limit. No records were omitted; the change was not committed.".to_owned());
    }
    Ok(output)
}

pub fn write_export(path: &Path, text: &str) -> LedgerResult<()> {
    let folder = path.parent().ok_or("Export folder is unavailable.")?;
    let mut file = tempfile::NamedTempFile::new_in(folder).map_err(storage_error)?;
    file.write_all(text.as_bytes()).map_err(storage_error)?;
    file.as_file().sync_all().map_err(storage_error)?;
    file.persist(path).map_err(storage_error)?;
    std::fs::File::open(folder)
        .and_then(|folder| folder.sync_all())
        .map_err(storage_error)?;
    Ok(())
}

fn insert_expense(transaction: &Transaction<'_>, expense: &Expense) -> LedgerResult<()> {
    transaction
        .execute(
            "INSERT INTO expenses(id, account_id, amount_cents, payload) VALUES(?1, ?2, ?3, ?4)",
            params![
                expense.id,
                expense.account_id,
                expense.amount_cents,
                serde_json::to_string(expense).map_err(storage_error)?
            ],
        )
        .map_err(storage_error)?;
    for line in &expense.allocations {
        transaction.execute("INSERT INTO allocations(id, expense_id, bucket, amount_cents) VALUES(?1, ?2, ?3, ?4)", params![line.id, expense.id, line.bucket, line.amount_cents]).map_err(storage_error)?;
    }
    transaction
        .execute(
            "INSERT INTO funding(expense_id, account_id, amount_cents) VALUES(?1, ?2, ?3)",
            params![expense.id, expense.account_id, expense.amount_cents],
        )
        .map_err(storage_error)?;
    Ok(())
}

fn read_snapshot(connection: &Connection) -> LedgerResult<Snapshot> {
    let revision = connection
        .query_row(
            "SELECT revision FROM ledger_state WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .map_err(storage_error)?;
    let epoch = connection
        .query_row("SELECT epoch FROM ledger_state WHERE id = 1", [], |row| {
            row.get(0)
        })
        .map_err(storage_error)?;
    let audit_count = connection
        .query_row(
            "SELECT (SELECT count(*) FROM audit) + (SELECT count(*) FROM recovery_log)",
            [],
            |row| row.get(0),
        )
        .map_err(storage_error)?;
    let accounts = read_payloads(connection, "SELECT payload FROM accounts ORDER BY rowid")?;
    let expenses = read_payloads(connection, "SELECT payload FROM expenses ORDER BY rowid")?;
    let reversals = read_payloads(
        connection,
        "SELECT json_object('expenseId', json_extract(request, '$.operation.expenseId'), 'reason', json_extract(request, '$.operation.reason')) FROM audit WHERE json_extract(request, '$.operation.type') IN ('reverseExpense','correctExpense') ORDER BY revision",
    )?;
    Ok(Snapshot {
        schema_version: 3,
        epoch,
        revision,
        accounts,
        expenses,
        imports: read_payloads(
            connection,
            "SELECT payload FROM bank_imports ORDER BY rowid",
        )?,
        bank_events: read_payloads(connection, "SELECT payload FROM bank_events ORDER BY rowid")?,
        reversals,
        audit_count,
    })
}

fn read_payloads<T: serde::de::DeserializeOwned>(
    connection: &Connection,
    sql: &str,
) -> LedgerResult<Vec<T>> {
    let mut statement = connection.prepare(sql).map_err(storage_error)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(storage_error)?;
    rows.map(|row| serde_json::from_str(&row.map_err(storage_error)?).map_err(storage_error))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account_command(store: &Store) -> Command {
        Command {
            expected_epoch: store.read().unwrap().epoch,
            command_id: Uuid::new_v4().to_string(),
            expected_revision: 0,
            operation: Operation::CreateAccount {
                account: Account {
                    id: Uuid::new_v4().to_string(),
                    name: "Synthetic account".to_owned(),
                    kind: "asset".to_owned(),
                    role: "personal".to_owned(),
                    currency: "AUD".to_owned(),
                    opening_balance_cents: None,
                    opening_date: None,
                    version: 1,
                },
            },
        }
    }

    fn expense_command(store: &Store, account_id: &str) -> Command {
        Command {
            expected_epoch: store.read().unwrap().epoch,
            command_id: Uuid::new_v4().to_string(),
            expected_revision: 1,
            operation: Operation::CreateExpense {
                expense: Expense {
                    id: Uuid::new_v4().to_string(),
                    account_id: account_id.to_owned(),
                    date: "2026-10-03".to_owned(),
                    description: "Synthetic groceries".to_owned(),
                    currency: "AUD".to_owned(),
                    amount_cents: 12000,
                    allocations: vec![Allocation {
                        id: Uuid::new_v4().to_string(),
                        bucket: "house".to_owned(),
                        person_id: None,
                        amount_cents: 12000,
                    }],
                    version: 1,
                },
            },
        }
    }

    #[test]
    fn persistence_restart_and_exact_retry() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("synthetic.sqlite3");
        let mut store = Store::open(&path).unwrap();
        let account = account_command(&store);
        let first = store.execute(account.clone()).unwrap();
        store
            .execute(expense_command(&store, &first.accounts[0].id))
            .unwrap();
        assert_eq!(store.execute(account).unwrap().revision, 2);
        drop(store);
        let restarted = Store::open(&path).unwrap();
        let snapshot = restarted.read().unwrap();
        assert_eq!(snapshot.revision, 2);
        assert_eq!(snapshot.audit_count, 2);
        assert_eq!(snapshot.accounts[0].opening_balance_cents, None);
        assert_eq!(snapshot.expenses[0].amount_cents, 12000);
    }

    #[test]
    fn stale_writer_and_command_identity_conflict_fail_without_changes() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("synthetic.sqlite3");
        let mut first = Store::open(&path).unwrap();
        let mut second = Store::open(&path).unwrap();
        let original = account_command(&first);
        first.execute(original.clone()).unwrap();
        assert!(
            second
                .execute(account_command(&second))
                .unwrap_err()
                .contains("ledger changed")
        );
        let mut changed = original;
        changed.expected_revision = 1;
        assert!(
            first
                .execute(changed)
                .unwrap_err()
                .contains("identity conflict")
        );
        assert_eq!(first.read().unwrap().audit_count, 1);
    }

    #[test]
    fn allocation_failure_rolls_back_expense_funding_revision_and_audit() {
        let folder = tempfile::tempdir().unwrap();
        let mut store = Store::open(&folder.path().join("synthetic.sqlite3")).unwrap();
        let state = store.execute(account_command(&store)).unwrap();
        let mut command = expense_command(&store, &state.accounts[0].id);
        if let Operation::CreateExpense { expense } = &mut command.operation {
            expense.allocations[0].amount_cents = 6000;
            expense.allocations.push(expense.allocations[0].clone());
        }
        assert!(store.execute(command).is_err());
        let snapshot = store.read().unwrap();
        assert!(snapshot.expenses.is_empty());
        assert_eq!(snapshot.revision, 1);
        assert_eq!(snapshot.audit_count, 1);
        let funding_count: i64 = store
            .connection
            .query_row("SELECT count(*) FROM funding", [], |row| row.get(0))
            .unwrap();
        assert_eq!(funding_count, 0);
    }

    #[test]
    fn foreign_keys_and_invalid_boundary_are_enforced() {
        let folder = tempfile::tempdir().unwrap();
        let mut store = Store::open(&folder.path().join("synthetic.sqlite3")).unwrap();
        let mut missing = expense_command(&store, &Uuid::new_v4().to_string());
        missing.expected_revision = 0;
        assert!(store.execute(missing).is_err());
        let mut invalid = account_command(&store);
        if let Operation::CreateAccount { account } = &mut invalid.operation {
            account.opening_balance_cents = Some(MAX_CENTS + 1);
            account.opening_date = Some("2026-02-29".to_owned());
        }
        assert!(
            store
                .execute(invalid)
                .unwrap_err()
                .contains("Invalid command")
        );
        assert_eq!(store.read().unwrap().revision, 0);
    }

    #[test]
    fn non_v4_identifiers_and_unsupported_account_versions_are_rejected() {
        let folder = tempfile::tempdir().unwrap();
        let mut store = Store::open(&folder.path().join("synthetic.sqlite3")).unwrap();
        let mut invalid = account_command(&store);
        if let Operation::CreateAccount { account } = &mut invalid.operation {
            account.id = "00000000-0000-0000-0000-000000000001".to_owned();
        }
        assert!(store.execute(invalid).is_err());
        let mut invalid = account_command(&store);
        if let Operation::CreateAccount { account } = &mut invalid.operation {
            account.version = 2;
        }
        assert!(store.execute(invalid).is_err());
        assert_eq!(store.read().unwrap().revision, 0);
    }

    #[test]
    fn lost_response_can_be_resolved_without_repeating_financial_effects() {
        let folder = tempfile::tempdir().unwrap();
        let mut store = Store::open(&folder.path().join("synthetic.sqlite3")).unwrap();
        let command = account_command(&store);
        assert!(store.resolve(command.clone()).unwrap().is_none());
        store.execute(command.clone()).unwrap();
        assert_eq!(
            store.resolve(command.clone()).unwrap().unwrap().audit_count,
            1
        );
        assert_eq!(store.execute(command).unwrap().audit_count, 1);
    }

    #[test]
    fn full_export_restore_reconciles_evidence_and_survives_restart() {
        let folder = tempfile::tempdir().unwrap();
        let mut source = Store::open(&folder.path().join("source.sqlite3")).unwrap();
        let account = source.execute(account_command(&source)).unwrap();
        source
            .execute(expense_command(&source, &account.accounts[0].id))
            .unwrap();
        let exported = source.export_json().unwrap();
        let expected = source.read().unwrap();
        let path = folder.path().join("target.sqlite3");
        let mut target = Store::open(&path).unwrap();
        let before = target.read().unwrap();
        let outcome = target
            .restore_json(&exported, &before.epoch, before.revision)
            .unwrap();
        assert_eq!(outcome.snapshot.expenses[0].amount_cents, 12000);
        assert_eq!(outcome.snapshot.accounts[0].id, expected.accounts[0].id);
        assert_ne!(outcome.snapshot.epoch, expected.epoch);
        assert_ne!(outcome.snapshot.epoch, before.epoch);
        assert_eq!(outcome.snapshot.audit_count, 3);
        assert!(folder.path().join(outcome.safety_file).exists());
        let roundtrip: ExportDocument =
            serde_json::from_str(&target.export_json().unwrap()).unwrap();
        let original: ExportDocument = serde_json::from_str(&exported).unwrap();
        assert_eq!(roundtrip.audit[0].request, original.audit[0].request);
        assert_eq!(roundtrip.audit[1].created_at, original.audit[1].created_at);
        let second_export = target.export_json().unwrap();
        let state = target.read().unwrap();
        target
            .restore_json(&second_export, &state.epoch, state.revision)
            .unwrap();
        drop(target);
        let restarted = Store::open(&path).unwrap().read().unwrap();
        assert_eq!(restarted.expenses[0].amount_cents, 12000);
        assert_eq!(restarted.audit_count, 4);
    }

    #[test]
    fn corrupt_newer_and_incomplete_exports_leave_existing_database_unchanged() {
        let folder = tempfile::tempdir().unwrap();
        let mut store = Store::open(&folder.path().join("synthetic.sqlite3")).unwrap();
        store.execute(account_command(&store)).unwrap();
        let before = store.export_json().unwrap();
        let snapshot = store.read().unwrap();
        let mut newer: serde_json::Value = serde_json::from_str(&before).unwrap();
        newer["schemaVersion"] = 999.into();
        let mut incomplete: serde_json::Value = serde_json::from_str(&before).unwrap();
        incomplete["audit"] = serde_json::json!([]);
        let mut path_injection: serde_json::Value = serde_json::from_str(&before).unwrap();
        path_injection["../../outside"] = "payload".into();
        let mut invalid_epoch: serde_json::Value = serde_json::from_str(&before).unwrap();
        let mut request: serde_json::Value =
            serde_json::from_str(invalid_epoch["audit"][0]["request"].as_str().unwrap()).unwrap();
        request["expectedEpoch"] = "corrupt-not-a-uuid".into();
        invalid_epoch["audit"][0]["request"] = request.to_string().into();
        for invalid in [
            "{".to_owned(),
            newer.to_string(),
            incomplete.to_string(),
            path_injection.to_string(),
            invalid_epoch.to_string(),
        ] {
            assert!(
                store
                    .restore_json(&invalid, &snapshot.epoch, snapshot.revision)
                    .is_err()
            );
            assert_eq!(store.export_json().unwrap(), before);
        }
    }

    #[test]
    fn restore_invalidates_old_views_and_rejects_stale_restore_confirmation() {
        let folder = tempfile::tempdir().unwrap();
        let mut store = Store::open(&folder.path().join("synthetic.sqlite3")).unwrap();
        let before = store.read().unwrap();
        let stale = account_command(&store);
        let exported = store.export_json().unwrap();
        store
            .restore_json(&exported, &before.epoch, before.revision)
            .unwrap();
        assert!(store.execute(stale).unwrap_err().contains("ledger changed"));
        assert!(
            store
                .restore_json(&exported, &before.epoch, before.revision)
                .is_err()
        );
        assert_eq!(store.read().unwrap().accounts.len(), 0);
    }

    #[test]
    fn failed_restore_insert_rolls_back_all_existing_state() {
        let folder = tempfile::tempdir().unwrap();
        let mut source = Store::open(&folder.path().join("source.sqlite3")).unwrap();
        let account = source.execute(account_command(&source)).unwrap();
        source
            .execute(expense_command(&source, &account.accounts[0].id))
            .unwrap();
        let mut target = Store::open(&folder.path().join("target.sqlite3")).unwrap();
        target.execute(account_command(&target)).unwrap();
        let original = target.export_json().unwrap();
        let state = target.read().unwrap();
        target.connection.execute_batch("CREATE TRIGGER synthetic_failure BEFORE INSERT ON expenses BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;").unwrap();
        assert!(
            target
                .restore_json(&source.export_json().unwrap(), &state.epoch, state.revision)
                .is_err()
        );
        assert_eq!(target.export_json().unwrap(), original);
    }

    #[test]
    fn export_cannot_replace_the_live_database_or_other_data_files() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("synthetic.sqlite3");
        let store = Store::open(&path).unwrap();
        assert!(store.export_to(&path).is_err());
        assert!(
            store
                .export_to(&folder.path().join("another.json"))
                .is_err()
        );
        let destination = tempfile::tempdir().unwrap();
        let exported = destination.path().join("synthetic.finance.json");
        store.export_to(&exported).unwrap();
        assert!(
            std::fs::read_to_string(exported)
                .unwrap()
                .contains("unencrypted")
        );
        assert_eq!(store.read().unwrap().revision, 0);
    }

    #[test]
    fn schema_one_migration_preserves_legacy_audit_and_can_restore() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("legacy.sqlite3");
        let mut legacy = Store::open(&path).unwrap();
        legacy.execute(account_command(&legacy)).unwrap();
        legacy.connection.execute_batch("UPDATE audit SET request = json_remove(request, '$.expectedEpoch'); ALTER TABLE ledger_state DROP COLUMN epoch; DROP TABLE recovery_log; DROP TABLE bank_imports; DROP TABLE bank_events; PRAGMA user_version = 1;").unwrap();
        let original: String = legacy
            .connection
            .query_row("SELECT request FROM audit", [], |row| row.get(0))
            .unwrap();
        drop(legacy);
        let migrated = Store::open(&path).unwrap();
        assert_eq!(migrated.read().unwrap().schema_version, 3);
        assert_eq!(migrated.read().unwrap().accounts.len(), 1);
        let mut target = Store::open(&folder.path().join("restored.sqlite3")).unwrap();
        let state = target.read().unwrap();
        target
            .restore_json(
                &migrated.export_json().unwrap(),
                &state.epoch,
                state.revision,
            )
            .unwrap();
        let restored: String = target
            .connection
            .query_row("SELECT request FROM audit", [], |row| row.get(0))
            .unwrap();
        assert_eq!(restored, original);
    }

    #[test]
    fn expense_reversal_retains_original_and_roundtrips_without_duplicate_effects() {
        let folder = tempfile::tempdir().unwrap();
        let mut store = Store::open(&folder.path().join("synthetic.sqlite3")).unwrap();
        let account = store.execute(account_command(&store)).unwrap();
        let original = store
            .execute(expense_command(&store, &account.accounts[0].id))
            .unwrap();
        let reverse = Command {
            command_id: Uuid::new_v4().to_string(),
            expected_epoch: original.epoch.clone(),
            expected_revision: original.revision,
            operation: Operation::ReverseExpense {
                expense_id: original.expenses[0].id.clone(),
                reason: "Entered twice manually".to_owned(),
            },
        };
        let state = store.execute(reverse.clone()).unwrap();
        assert_eq!(state.expenses[0].amount_cents, 12000);
        assert_eq!(state.reversals.len(), 1);
        assert_eq!(store.execute(reverse.clone()).unwrap().audit_count, 3);
        let mut duplicate = reverse;
        duplicate.command_id = Uuid::new_v4().to_string();
        duplicate.expected_revision = state.revision;
        assert!(
            store
                .execute(duplicate)
                .unwrap_err()
                .contains("already reversed")
        );
        let exported = store.export_json().unwrap();
        let mut restored = Store::open(&folder.path().join("restored.sqlite3")).unwrap();
        let empty = restored.read().unwrap();
        let result = restored
            .restore_json(&exported, &empty.epoch, empty.revision)
            .unwrap();
        assert_eq!(
            result.snapshot.reversals[0].reason,
            "Entered twice manually"
        );
        assert_eq!(result.snapshot.expenses[0].id, original.expenses[0].id);
    }

    #[test]
    fn correction_commits_replacement_and_reversal_together() {
        let folder = tempfile::tempdir().unwrap();
        let mut store = Store::open(&folder.path().join("synthetic.sqlite3")).unwrap();
        let account = store.execute(account_command(&store)).unwrap();
        let state = store
            .execute(expense_command(&store, &account.accounts[0].id))
            .unwrap();
        let original = state.expenses[0].clone();
        let mut replacement = original.clone();
        replacement.id = Uuid::new_v4().to_string();
        let mut correction = Command {
            command_id: Uuid::new_v4().to_string(),
            expected_epoch: state.epoch.clone(),
            expected_revision: state.revision,
            operation: Operation::CorrectExpense {
                expense_id: original.id.clone(),
                reason: "Corrected manual amount".to_owned(),
                replacement: replacement.clone(),
            },
        };
        assert!(store.execute(correction.clone()).is_err());
        assert!(store.read().unwrap().reversals.is_empty());
        assert_eq!(store.read().unwrap().revision, 2);
        replacement.amount_cents = 13000;
        replacement.allocations[0].id = Uuid::new_v4().to_string();
        replacement.allocations[0].amount_cents = 13000;
        correction.operation = Operation::CorrectExpense {
            expense_id: original.id.clone(),
            reason: "Corrected manual amount".to_owned(),
            replacement,
        };
        let corrected = store.execute(correction.clone()).unwrap();
        assert_eq!(corrected.reversals[0].expense_id, original.id);
        assert_eq!(corrected.expenses[0].amount_cents, 12000);
        assert_eq!(corrected.expenses[1].amount_cents, 13000);
        assert_eq!(store.execute(correction).unwrap().audit_count, 3);
        let state = store.read().unwrap();
        let exported = store.export_json().unwrap();
        let restored = store
            .restore_json(&exported, &state.epoch, state.revision)
            .unwrap();
        assert_eq!(restored.snapshot.reversals.len(), 1);
        assert_eq!(restored.snapshot.expenses.len(), 2);
    }

    #[test]
    fn imported_occurrences_retry_overlap_and_restore_preserve_evidence() {
        let folder = tempfile::tempdir().unwrap();
        let mut store = Store::open(&folder.path().join("synthetic.sqlite3")).unwrap();
        let account = store.execute(account_command(&store)).unwrap();
        let csv = "Date,Description,Credit,Debit,Balance\n3/10/2026,Synthetic repeated purchase,,-9.99,\n3/10/2026,Synthetic repeated purchase,,-9.99,\n3/10/2026,Synthetic repeated purchase,,-9.99,\n";
        let rows: Vec<_> = (2..=4)
            .map(|ordinal| ImportRow {
                observation: Observation {
                    ordinal,
                    raw_fields: vec![
                        "3/10/2026".to_owned(),
                        "Synthetic repeated purchase".to_owned(),
                        "".to_owned(),
                        "-9.99".to_owned(),
                        "".to_owned(),
                    ],
                    date: "2026-10-03".to_owned(),
                    description: "Synthetic repeated purchase".to_owned(),
                    comparison_description: "Synthetic repeated purchase".to_owned(),
                    amount_cents: -999,
                    balance_cents: None,
                    currency: "AUD".to_owned(),
                },
                event_id: Uuid::new_v4().to_string(),
                decision: "new".to_owned(),
            })
            .collect();
        let record = BankImport {
            id: Uuid::new_v4().to_string(),
            account_id: account.accounts[0].id.clone(),
            profile: "ing".to_owned(),
            file_name: "synthetic.csv".to_owned(),
            content_hash: format!("{:x}", Sha256::digest(csv.as_bytes())),
            headers: Some(vec![
                "Date".to_owned(),
                "Description".to_owned(),
                "Credit".to_owned(),
                "Debit".to_owned(),
                "Balance".to_owned(),
            ]),
            original_base64: Some(base64::engine::general_purpose::STANDARD.encode(csv)),
            rows,
        };
        let make_command = |record: BankImport, state: &Snapshot| Command {
            command_id: Uuid::new_v4().to_string(),
            expected_epoch: state.epoch.clone(),
            expected_revision: state.revision,
            operation: Operation::CommitImport { import: record },
        };
        let first = store
            .execute(make_command(record.clone(), &account))
            .unwrap();
        assert_eq!(first.bank_events.len(), 3);
        assert!(first.expenses.is_empty());
        let mut renamed = record.clone();
        renamed.id = Uuid::new_v4().to_string();
        renamed.file_name = "renamed.csv".to_owned();
        let retry = store.execute(make_command(renamed, &first)).unwrap();
        assert_eq!(retry.bank_events.len(), 3);
        assert_eq!(retry.imports.len(), 1);
        assert_eq!(retry.audit_count, 3);
        let mut overlap = record.clone();
        overlap.id = Uuid::new_v4().to_string();
        overlap.content_hash = "a".repeat(64);
        overlap.original_base64 = None;
        for row in &mut overlap.rows {
            row.decision = "existing".to_owned();
        }
        let mut added = overlap.rows[0].clone();
        added.observation.ordinal = 5;
        added.event_id = Uuid::new_v4().to_string();
        added.decision = "new".to_owned();
        overlap.rows.push(added);
        let state = store.execute(make_command(overlap, &retry)).unwrap();
        assert_eq!(state.bank_events.len(), 4);
        assert_eq!(state.imports.len(), 2);
        let exported = store.export_json().unwrap();
        let mut fresh = Store::open(&folder.path().join("fresh.sqlite3")).unwrap();
        let empty = fresh.read().unwrap();
        let restored = fresh
            .restore_json(&exported, &empty.epoch, empty.revision)
            .unwrap();
        assert_eq!(restored.snapshot.bank_events.len(), 4);
        assert_eq!(restored.snapshot.imports[0].rows.len(), 3);
        assert_eq!(
            restored.snapshot.imports[0].original_base64,
            record.original_base64
        );
        assert_eq!(restored.snapshot.bank_events[0].id, first.bank_events[0].id);
    }
}
