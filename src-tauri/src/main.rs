// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    // Determine the project directory (for reading frontend files)
    // In development: use the project root
    // In production (bundled): use the resource directory
    let resource_dir = if cfg!(debug_assertions) {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));
        exe_dir.parent()
            .map(|p| p.join("Resources"))
            .filter(|p| p.exists())
            .unwrap_or_else(|| exe_dir.clone())
    };

    // Data directory (for writing database and config) — must be writable
    // In production, use ~/.local/share/sms-gateway/ (XDG data dir)
    let data_dir = if cfg!(debug_assertions) {
        resource_dir.clone()
    } else {
        std::env::var("HOME")
            .ok()
            .map(|home| {
                let dir = PathBuf::from(home).join(".local").join("share").join("sms-gateway");
                std::fs::create_dir_all(&dir).ok();
                dir
            })
            .unwrap_or_else(|| resource_dir.clone())
    };

    // Database path (writable location)
    let db_path = data_dir.join("data.db");
    let db_path_str = db_path.to_string_lossy().to_string();
    tracing::info!("Data directory: {:?}", data_dir);
    tracing::info!("Database: {:?}", db_path);

    // Initialize database and app state (resource_dir for serving frontend, data_dir for DB)
    let state = sms_gateway_lib::initialize(&db_path_str, &resource_dir);
    // project_dir is cloned into state, so we can still use it below
    let state_clone = state.clone();

    // Find an available port
    let port = find_available_port().await;

    // Start the HTTP server
    tracing::info!("Starting server on 127.0.0.1:{}", port);
    let (_addr, _server_handle) = sms_gateway_lib::start_server(state, port).await;

    // Start the background scheduler (checks every 10 seconds)
    let _scheduler_handle = sms_gateway_lib::start_scheduler(state_clone, 10);

    tracing::info!("Server running at http://127.0.0.1:{}", port);
    tracing::info!("Starting Tauri webview...");

    // Start Tauri with the webview pointing to our local server
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            let url = format!("http://127.0.0.1:{}", port);

            // Wait for the server to be ready by polling TCP port
            for attempt in 0..30 {
                if std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
                    tracing::info!("Server ready after {} attempts", attempt + 1);
                    break;
                }
                tracing::info!("Waiting for server... attempt {}", attempt + 1);
                std::thread::sleep(std::time::Duration::from_millis(200));
            }

            // Get the existing "main" window created by Tauri config and navigate it
            if let Some(window) = app.get_webview_window("main") {
                if let Err(e) = window.navigate(url.parse().unwrap()) {
                    tracing::error!("Failed to navigate to server: {}", e);
                }
                let _ = window.set_title("SMS Gateway Dashboard");
                let _ = window.set_focus();
            }

            // Check for updates on startup (non-blocking)
            let app_handle = app.handle().clone();
            tokio::spawn(async move {
                match app_handle.updater() {
                    Ok(updater) => {
                        match updater.check().await {
                            Ok(Some(update)) => {
                                tracing::info!("Update available: {}", update.version);
                                if let Err(e) = update.download_and_install(|_event, _total| {}, || {}).await {
                                    tracing::error!("Failed to install update: {}", e);
                                } else {
                                    tracing::info!("Update installed, restarting...");
                                    app_handle.restart();
                                }
                            }
                            Ok(None) => {
                                tracing::info!("App is up to date");
                            }
                            Err(e) => {
                                tracing::warn!("Update check failed: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to get updater instance: {}", e);
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|_win, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                tracing::info!("Window closing - shutting down server");
                // The server will be killed when the tokio runtime drops
                std::process::exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


/// Find an available TCP port by binding to port 0
async fn find_available_port() -> u16 {
    tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map(|listener| {
            let port = listener.local_addr().unwrap().port();
            // Drop the listener so the port is free for the server
            drop(listener);
            port
        })
        .unwrap_or(3000) // Fallback
}
