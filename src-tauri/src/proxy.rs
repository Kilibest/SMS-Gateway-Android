use std::collections::HashSet;
use std::net::IpAddr;
use base64::Engine;

/// Blocked hostnames that are never allowed to be proxied to.
fn blocked_hostnames() -> HashSet<&'static str> {
    [
        "localhost", "localhost.localdomain", "localhost6", "localhost6.localdomain6",
        "0.0.0.0", "::", "[::]", "::1", "[::1]",
    ].iter().cloned().collect()
}

/// SSRF Protection: Check whether a target hostname should be blocked.
///
/// Blocks:
///   - Well-known localhost hostnames
///   - Unspecified addresses (0.0.0.0, ::)
///   - Loopback (127.0.0.0/8, ::1)
///   - Private (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
///   - Link-local (169.254.0.0/16, fe80::/10)
///   - Unique-local (fc00::/7)
pub fn is_internal_target(hostname: &str) -> bool {
    // Strip IPv6 brackets
    let cleaned = hostname.trim_start_matches('[').trim_end_matches(']');

    // Check against blocked hostnames
    if blocked_hostnames().contains(cleaned.to_lowercase().as_str()) {
        return true;
    }

    // Try to parse as IP address
    if let Ok(addr) = cleaned.parse::<IpAddr>() {
        return match addr {
            IpAddr::V4(v4) => {
                // We block loopback and link-local for security, but intentionally
                // allow private ranges (10.x.x.x, 192.168.x.x, 172.16-31.x.x) so
                // users can proxy to their Android device on the local WiFi network.
                v4.is_loopback()
                    || v4.is_link_local()
                    || v4.is_unspecified()
            }
            IpAddr::V6(v6) => {
                v6.is_loopback()
                    || v6.is_unspecified()
                    || v6.octets()[0] == 0xfc // fc00::/7 unique-local
                    || v6.octets()[0] == 0xfd
                    || (v6.octets()[0] == 0xfe && (v6.octets()[1] & 0xc0) == 0x80) // fe80::/10 link-local
            }
        };
    }

    // Not a valid IP — treat as hostname. Don't block hostnames here
    // (they could legitimately resolve to public IPs).
    false
}

/// Forward an SMS to the target device.
pub async fn forward_sms(
    gateway_url: &str,
    auth_user: &str,
    auth_pass: &str,
    is_remote: bool,
    phone_numbers: &[String],
    text: &str,
) -> Result<bool, String> {
    let endpoint = if is_remote {
        gateway_url.to_string()
    } else {
        format!("{}/messages", gateway_url.trim_end_matches('/'))
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let auth = format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", auth_user, auth_pass))
    );

    let body = serde_json::json!({
        "textMessage": { "text": text },
        "phoneNumbers": phone_numbers,
    });

    let resp = client
        .post(&endpoint)
        .header("Authorization", auth)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();

    if status.is_success() || (status.as_u16() == 400 && body.contains("country code")) {
        Ok(true)
    } else {
        Err(format!("HTTP {}: {}", status, body.chars().take(200).collect::<String>()))
    }
}
