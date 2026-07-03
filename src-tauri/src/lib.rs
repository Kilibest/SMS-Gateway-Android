pub mod models;
pub mod db;
pub mod proxy;
pub mod scheduler;
pub mod server;
pub mod embedded;

use std::sync::Arc;
use std::path::PathBuf;
use tokio::sync::Mutex;
use std::collections::VecDeque;

use crate::db::Database;
use crate::server::AppState;

/// Initialize the database and app state.
pub fn initialize(db_path: &str, project_dir: &PathBuf) -> AppState {
    let db = Arc::new(Database::new(db_path).expect("Failed to initialize database"));
    AppState {
        db,
        received_messages: Arc::new(Mutex::new(VecDeque::new())),
        project_dir: project_dir.clone(),
    }
}

/// Start the embedded HTTP server and return its address and a shutdown handle.
pub async fn start_server(state: AppState, port: u16) -> (std::net::SocketAddr, tokio::task::JoinHandle<()>) {
    use tokio::net::TcpListener;

    let router = crate::server::build_router(state.clone());

    let listener = TcpListener::bind(format!("127.0.0.1:{}", port))
        .await
        .expect("Failed to bind to port");

    let addr = listener.local_addr().unwrap();

    let handle = tokio::spawn(async move {
        axum::serve(listener, router)
            .await
            .expect("Server failed");
    });

    (addr, handle)
}

/// Start the background scheduler for due messages.
pub fn start_scheduler(state: AppState, interval_secs: u64) -> tokio::task::JoinHandle<()> {
    scheduler::start_scheduler(state.db, interval_secs)
}
