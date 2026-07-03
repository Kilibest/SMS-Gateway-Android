// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    // Determine the project directory
    // In development: use the project root
    // In production (bundled): use the resource directory
    let project_dir = if cfg!(debug_assertions) {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        // When bundled, the executable is in the resources directory
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));
        
        // Try to find the project files relative to the exe
        // In Tauri bundles, static files should be in ../Resources or similar
        let resource_dir = exe_dir.parent()
            .map(|p| p.join("Resources"))
            .filter(|p| p.exists())
            .unwrap_or_else(|| exe_dir.clone());

        resource_dir
    };

    // Database path
    let db_path = project_dir.join("data.db");
    let db_path_str = db_path.to_string_lossy().to_string();

    // Initialize database and app state
    let state = sms_gateway_lib::initialize(&db_path_str, &project_dir);
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
        .setup(move |app| {
            let url = format!("http://127.0.0.1:{}", port);

            // Wait a moment for the server to be ready
            std::thread::sleep(std::time::Duration::from_millis(200));

            // Create the webview window
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(url.parse().unwrap()),
            )
            .title("SMS Gateway Dashboard")
            .inner_size(1200.0, 800.0)
            .min_inner_size(900.0, 600.0)
            .resizable(true)
            .center()
            .build()?;

            // Focus the window
            let _ = window.set_focus();

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
