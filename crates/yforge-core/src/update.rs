use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum UpdateCheck {
    UpToDate {
        version: String,
    },
    Available {
        current: String,
        version: String,
        notes: String,
    },
}

impl UpdateCheck {
    pub fn from_release(current: &str, newer: Option<(&str, Option<&str>)>) -> Self {
        match newer {
            None => Self::UpToDate {
                version: current.to_owned(),
            },
            Some((version, notes)) => Self::Available {
                current: current.to_owned(),
                version: version.to_owned(),
                notes: notes.unwrap_or_default().to_owned(),
            },
        }
    }
}
