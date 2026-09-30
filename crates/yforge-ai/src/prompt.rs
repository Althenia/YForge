#[derive(Debug, Clone)]
pub struct Prompt {
    pub system: &'static str,
    pub user: String,
}

impl Prompt {
    pub fn combined(&self) -> String {
        format!("{}\n\n{}", self.system, self.user)
    }
}

pub const COMMIT_SYSTEM: &str = "You write Git commit messages. Reply with one JSON object and nothing else, in exactly this shape: {\"summary\": string, \"description\": string}. The summary is one line of at most 72 characters in the imperative mood, without a trailing period, and follows the style of the recent commit subjects you are given. The description explains what changed and why in plain paragraphs wrapped at 72 columns, or is an empty string when the summary is enough. Base the message only on the staged changes provided. Do not use tools, do not read files, and do not wrap the JSON in any other text.";

pub const RECOMPOSE_SYSTEM: &str = "You regroup the changes of unpushed Git commits into a new series of commits. You receive a list of units: each hunk has an id, and some files can only be moved as a whole. Reply with one JSON object and nothing else, in exactly this shape: {\"groups\": [{\"message\": string, \"changes\": [{\"kind\": \"hunk\", \"id\": string} or {\"kind\": \"file\", \"path\": string}]}]}. Every hunk id and every whole-file unit must appear in exactly one group; never invent ids or paths, and never list a hunk of a file that you also list as a whole file. Groups become commits in the order given, so order them so that each commit is a coherent, reviewable step. A message is a summary line of at most 72 characters in the imperative mood, optionally followed by a blank line and a description. Do not use tools, do not read files, and do not wrap the JSON in any other text.";

pub const CONFLICT_SYSTEM: &str = "You resolve Git merge conflicts. You receive numbered conflict regions; each has the CURRENT side (the checked-out branch), the INCOMING side, and sometimes the BASE (the common ancestor), with a few lines of surrounding context. Reply with one JSON object and nothing else, in exactly this shape: {\"regions\": [{\"index\": number, \"text\": string, \"rationale\": string}]}. Give exactly one entry per region. text is the complete replacement for that region: the resolved lines joined with newline characters, without conflict markers and without the surrounding context, and an empty string when the region should resolve to no lines. rationale is one or two sentences saying why. Preserve the intent of both sides where they are compatible. Do not use tools, do not read files, and do not wrap the JSON in any other text.";
