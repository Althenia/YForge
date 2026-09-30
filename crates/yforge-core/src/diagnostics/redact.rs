use crate::activity::redact_embedded;

const TEXT_LIMIT: usize = 64 * 1024;
const REPOSITORY_MARK: &str = "<repository>";

#[derive(Debug, Clone, Default)]
pub struct Redactor {
    home: Option<String>,
    repositories: Vec<String>,
}

fn trimmed(path: &str) -> Option<String> {
    let path = path.trim_end_matches(['/', '\\']);
    (path.len() > 1).then(|| path.to_owned())
}

fn replace_path(text: &str, path: &str, replacement: &str) -> String {
    let mut replaced = String::with_capacity(text.len());
    let mut last = 0;
    for (start, _) in text.match_indices(path) {
        let end = start + path.len();
        let continues = text[end..]
            .chars()
            .next()
            .is_some_and(|next| next.is_alphanumeric() || next == '_' || next == '-');
        if start >= last && !continues {
            replaced.push_str(&text[last..start]);
            replaced.push_str(replacement);
            last = end;
        }
    }
    replaced.push_str(&text[last..]);
    replaced
}

impl Redactor {
    pub fn new(home: Option<&str>, repositories: &[String]) -> Self {
        let mut repositories: Vec<String> = repositories
            .iter()
            .filter_map(|path| trimmed(path))
            .collect();
        repositories.sort_by_key(|path| std::cmp::Reverse(path.len()));
        repositories.dedup();
        Self {
            home: home.and_then(trimmed),
            repositories,
        }
    }

    pub fn from_environment(repositories: &[String]) -> Self {
        let home = std::env::var("HOME")
            .ok()
            .or_else(|| std::env::var("USERPROFILE").ok());
        Self::new(home.as_deref(), repositories)
    }

    pub fn redact(&self, text: &str) -> String {
        let mut text = redact_embedded(text);
        for repository in &self.repositories {
            text = replace_path(&text, repository, REPOSITORY_MARK);
        }
        if let Some(home) = &self.home {
            text = replace_path(&text, home, "~");
        }
        if text.len() > TEXT_LIMIT {
            let mut end = TEXT_LIMIT;
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            text.truncate(end);
        }
        text
    }
}
