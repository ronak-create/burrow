//! BYOK key storage in the OS keychain (Windows Credential Manager / macOS Keychain
//! / Secret Service). Keys never touch settings.json and never leave this machine
//! except in the request the user's own provider call makes.
//!
//! `has_api_key` exists so settings UI can show what is configured without ever
//! pulling actual key material into the frontend. Only the provider layer calls
//! `get_api_key`.

use keyring::Entry;

const SERVICE: &str = "burrow";

fn entry(provider: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, provider).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_api_key(provider: String, key: String) -> Result<(), String> {
    entry(&provider)?.set_password(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_api_key(provider: String) -> Result<Option<String>, String> {
    match entry(&provider)?.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn has_api_key(provider: String) -> Result<bool, String> {
    Ok(get_api_key(provider)?.is_some())
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    match entry(&provider)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// The keychain cannot be enumerated, so the frontend passes the provider ids it
/// knows about and we report which of them have a key stored. This drives the
/// capability registry (spec E: each feature lights up as its key appears).
#[tauri::command]
pub fn configured_providers(providers: Vec<String>) -> Vec<String> {
    providers
        .into_iter()
        .filter(|p| matches!(get_api_key(p.clone()), Ok(Some(_))))
        .collect()
}
