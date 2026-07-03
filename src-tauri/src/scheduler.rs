use std::sync::Arc;
use std::time::Duration;
use tokio::time;
use tracing::{info, error};
use crate::db::Database;
use crate::proxy;

/// Start the background scheduler that checks for due messages every N seconds.
/// Returns a handle that can be used to abort the task.
pub fn start_scheduler(db: Arc<Database>, interval_secs: u64) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(interval_secs));

        // Run immediately on start
        tick(&db).await;

        loop {
            interval.tick().await;
            tick(&db).await;
        }
    })
}

async fn tick(db: &Database) {
    let due = db.get_due_scheduled_messages();
    if due.is_empty() {
        return;
    }

    info!("[Scheduler] {} due messages found", due.len());

    for msg in due {
        let phone_numbers: Vec<String> = if msg.isGroup {
            if let Some(ref recipients) = msg.recipients {
                recipients.clone()
            } else {
                vec![msg.phone.clone()]
            }
        } else {
            vec![msg.phone.clone()]
        };

        let gateway_url = msg.gatewayUrl.unwrap_or_default();
        let auth_user = msg.authUser.unwrap_or_default();
        let auth_pass = msg.authPass.unwrap_or_default();

        match proxy::forward_sms(
            &gateway_url,
            &auth_user,
            &auth_pass,
            msg.isRemote,
            &phone_numbers,
            &msg.text,
        ).await {
            Ok(true) => {
                db.update_scheduled_status(&msg.id, "sent", None);
                info!("[Scheduler] Sent scheduled message {} to {}", msg.id, msg.phone);
            }
            Ok(false) => {
                let err_str = "Unknown error".to_string();
                db.update_scheduled_status(&msg.id, "failed", Some(&err_str));
                error!("[Scheduler] Failed scheduled message {}: {}", msg.id, err_str);
            }
            Err(e) => {
                let err_str = e;
                db.update_scheduled_status(&msg.id, "failed", Some(&err_str));
                error!("[Scheduler] Failed scheduled message {}: {}", msg.id, err_str);
            }
        }
    }
}
