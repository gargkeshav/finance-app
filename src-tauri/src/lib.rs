mod ledger;

use ledger::{Command, RestoreResult, Snapshot, Store};
use std::io::Read;
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[tauri::command]
fn read_ledger(store: tauri::State<'_, Arc<Mutex<Store>>>) -> Result<Snapshot, String> {
    store
        .lock()
        .map_err(|_| "Storage is unavailable.".to_owned())?
        .read()
}

#[tauri::command]
fn execute_ledger(
    command: Command,
    store: tauri::State<'_, Arc<Mutex<Store>>>,
) -> Result<Snapshot, String> {
    store
        .lock()
        .map_err(|_| "Storage is unavailable.".to_owned())?
        .execute(command)
}

#[tauri::command]
fn resolve_ledger(
    command: Command,
    store: tauri::State<'_, Arc<Mutex<Store>>>,
) -> Result<Option<Snapshot>, String> {
    store
        .lock()
        .map_err(|_| "Storage is unavailable.".to_owned())?
        .resolve(command)
}

#[tauri::command]
async fn export_ledger(store: tauri::State<'_, Arc<Mutex<Store>>>) -> Result<bool, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .set_title("Export unencrypted finance ledger")
            .add_filter("Finance JSON", &["json"])
            .set_file_name("ledger-unencrypted.finance.json")
            .save_file()
        else {
            return Ok(false);
        };
        store
            .lock()
            .map_err(|_| "Storage is unavailable.")?
            .export_to(&path)?;
        Ok(true)
    })
    .await
    .map_err(|_| "Export could not be completed.".to_owned())?
}

#[tauri::command]
async fn restore_ledger(
    expected_epoch: String,
    expected_revision: i64,
    confirmed: bool,
    store: tauri::State<'_, Arc<Mutex<Store>>>,
) -> Result<Option<RestoreResult>, String> {
    if !confirmed {
        return Err("Restore requires explicit confirmation.".to_owned());
    }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new().set_title("Choose a finance ledger export").add_filter("Finance JSON", &["json"]).pick_file() else { return Ok(None); };
        let choice = rfd::MessageDialog::new().set_title("Replace this ledger?").set_description("The selected export will replace all current accounts and expenses. A safety copy of the existing ledger will be saved first. Both files are unencrypted.").set_level(rfd::MessageLevel::Warning).set_buttons(rfd::MessageButtons::OkCancel).show();
        if choice != rfd::MessageDialogResult::Ok { return Ok(None); }
        let file = std::fs::File::open(path).map_err(|_| "Cannot open the selected export.")?;
        let mut text = String::new();
        file.take((ledger::MAX_EXPORT_BYTES + 1) as u64).read_to_string(&mut text).map_err(|_| "Cannot read the selected export as UTF-8 JSON.")?;
        let result = store.lock().map_err(|_| "Storage is unavailable.")?.restore_json(&text, &expected_epoch, expected_revision)?;
        Ok(Some(result))
    }).await.map_err(|_| "Restore could not be completed. Reload to check the current ledger.".to_owned())?
}

#[cfg(debug_assertions)]
#[tauri::command]
fn finish_native_smoke(success: bool, app: tauri::AppHandle) -> Result<(), String> {
    let folder = std::env::var_os("FINANCEAPP_SMOKE_DIR").ok_or("Smoke profile is not enabled.")?;
    std::fs::write(
        std::path::PathBuf::from(folder).join("result.txt"),
        if success { "pass" } else { "fail" },
    )
    .map_err(|_| "Cannot write smoke result.")?;
    app.exit(if success { 0 } else { 1 });
    Ok(())
}

pub fn run() {
    let builder = tauri::Builder::default().setup(|app| {
        let folder = app.path().app_data_dir()?;
        #[cfg(debug_assertions)]
        let folder = std::env::var_os("FINANCEAPP_SMOKE_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or(folder);
        std::fs::create_dir_all(&folder)?;
        let store = Store::open(&folder.join("ledger.sqlite3")).map_err(std::io::Error::other)?;
        app.manage(Arc::new(Mutex::new(store)));
        Ok(())
    });
    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        read_ledger,
        execute_ledger,
        resolve_ledger,
        export_ledger,
        restore_ledger,
        finish_native_smoke
    ]);
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        read_ledger,
        execute_ledger,
        resolve_ledger,
        export_ledger,
        restore_ledger
    ]);
    builder
        .run(tauri::generate_context!())
        .expect("The desktop runtime could not start.");
}
