use std::time::Duration;

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub completion: Duration,
    pub status: Duration,
    pub discovery: Duration,
    pub sign_in: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            completion: Duration::from_secs(180),
            status: Duration::from_secs(20),
            discovery: Duration::from_secs(5),
            sign_in: Duration::from_secs(16 * 60),
        }
    }
}

pub fn seconds(duration: Duration) -> u32 {
    u32::try_from(duration.as_secs()).unwrap_or(u32::MAX)
}
