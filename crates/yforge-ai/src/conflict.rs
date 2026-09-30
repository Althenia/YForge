use serde::Deserialize;
use yforge_core::{
    is_secret_file, ConflictFile, ConflictProposal, ConflictRegionProposal, ConflictSegment,
};

use crate::error::{AiError, Result};
use crate::json::{cap, parse_reply};
use crate::prompt::{Prompt, CONFLICT_SYSTEM};

const TOTAL_BUDGET: usize = 60 * 1024;
const CONTEXT_LINES: usize = 3;

pub fn region_count(file: &ConflictFile) -> usize {
    file.segments
        .iter()
        .filter(|segment| matches!(segment, ConflictSegment::Conflict { .. }))
        .count()
}

fn block(title: &str, lines: &[String]) -> String {
    let body: String = lines.iter().map(|line| format!("{line}\n")).collect();
    format!("{title}:\n{body}")
}

pub fn prompt(file: &ConflictFile) -> Result<Prompt> {
    if is_secret_file(&file.file) {
        return Err(AiError::invalid(format!(
            "{} is withheld from AI as a secret file",
            file.file
        )));
    }
    if file.binary {
        return Err(AiError::invalid(format!("{} is binary", file.file)));
    }
    if region_count(file) == 0 {
        return Err(AiError::invalid(format!(
            "{} has no conflict regions",
            file.file
        )));
    }
    let mut text = format!("File: {}\n", file.file);
    let mut index = 0;
    for (position, segment) in file.segments.iter().enumerate() {
        let ConflictSegment::Conflict {
            current,
            incoming,
            base,
        } = segment
        else {
            continue;
        };
        text.push_str(&format!("\n### Region {index}\n"));
        if let Some(ConflictSegment::Text { lines }) = position
            .checked_sub(1)
            .and_then(|before| file.segments.get(before))
        {
            let start = lines.len().saturating_sub(CONTEXT_LINES);
            text.push_str(&block("CONTEXT BEFORE", &lines[start..]));
        }
        text.push_str(&block("CURRENT", current));
        if let Some(base) = base {
            text.push_str(&block("BASE", base));
        }
        text.push_str(&block("INCOMING", incoming));
        if let Some(ConflictSegment::Text { lines }) = file.segments.get(position + 1) {
            text.push_str(&block(
                "CONTEXT AFTER",
                &lines[..lines.len().min(CONTEXT_LINES)],
            ));
        }
        index += 1;
    }
    if text.len() > TOTAL_BUDGET {
        return Err(AiError::invalid(format!(
            "the conflicts in {} are too large to send ({} KB; the limit is {} KB)",
            file.file,
            text.len() / 1024,
            TOTAL_BUDGET / 1024
        )));
    }
    Ok(Prompt {
        system: CONFLICT_SYSTEM,
        user: text,
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reply {
    regions: Vec<Region>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Region {
    index: u32,
    text: String,
    rationale: String,
}

fn has_marker_line(text: &str) -> bool {
    text.lines()
        .any(|line| line.starts_with("<<<<<<<") || line.starts_with(">>>>>>>") || line == "=======")
}

pub fn parse(label: &str, reply: &str, regions: usize) -> Result<ConflictProposal> {
    let invalid = |reason: String| AiError::InvalidResponse {
        provider: label.to_owned(),
        reason: cap(&reason),
    };
    let value = parse_reply(reply).map_err(invalid)?;
    let parsed: Reply =
        serde_json::from_value(value).map_err(|error| invalid(error.to_string()))?;
    let mut proposals: Vec<Option<ConflictRegionProposal>> = vec![None; regions];
    for region in parsed.regions {
        let slot = usize::try_from(region.index)
            .ok()
            .and_then(|index| proposals.get_mut(index))
            .ok_or_else(|| invalid(format!("region {} does not exist", region.index)))?;
        if slot.is_some() {
            return Err(invalid(format!("region {} appears twice", region.index)));
        }
        if has_marker_line(&region.text) {
            return Err(invalid(format!(
                "the text for region {} contains conflict markers",
                region.index
            )));
        }
        let text = region.text.strip_suffix('\n').unwrap_or(&region.text);
        *slot = Some(ConflictRegionProposal {
            index: region.index,
            text: text.to_owned(),
            rationale: region.rationale.trim().to_owned(),
        });
    }
    let mut complete = Vec::with_capacity(regions);
    for (index, proposal) in proposals.into_iter().enumerate() {
        complete.push(proposal.ok_or_else(|| invalid(format!("region {index} has no proposal")))?);
    }
    Ok(ConflictProposal { regions: complete })
}

#[cfg(test)]
mod tests {
    use super::*;
    use yforge_core::ConflictSides;

    fn lines(items: &[&str]) -> Vec<String> {
        items.iter().map(|line| (*line).to_owned()).collect()
    }

    fn file(name: &str) -> ConflictFile {
        ConflictFile {
            file: name.to_owned(),
            eol: "\n".to_owned(),
            final_newline: true,
            binary: false,
            sides: ConflictSides {
                base: true,
                current: true,
                incoming: true,
            },
            segments: vec![
                ConflictSegment::Text {
                    lines: lines(&["a", "b", "c", "d"]),
                },
                ConflictSegment::Conflict {
                    current: lines(&["mine"]),
                    incoming: lines(&["theirs"]),
                    base: Some(lines(&["orig"])),
                },
                ConflictSegment::Text {
                    lines: lines(&["e", "f", "g", "h"]),
                },
                ConflictSegment::Conflict {
                    current: lines(&[]),
                    incoming: lines(&["added"]),
                    base: None,
                },
            ],
        }
    }

    #[test]
    fn the_prompt_numbers_regions_with_both_sides_base_and_nearby_context() {
        let prompt = prompt(&file("src/lib.rs")).unwrap();
        let text = &prompt.user;
        assert!(text.contains("### Region 0"));
        assert!(text.contains("CONTEXT BEFORE:\nb\nc\nd\n"));
        assert!(text.contains("CURRENT:\nmine\n"));
        assert!(text.contains("BASE:\norig\n"));
        assert!(text.contains("INCOMING:\ntheirs\n"));
        assert!(text.contains("CONTEXT AFTER:\ne\nf\ng\n"));
        assert!(text.contains("### Region 1"));
        assert!(text.contains("CONTEXT BEFORE:\nf\ng\nh\n"));
        assert_eq!(text.matches("BASE:").count(), 1);
    }

    #[test]
    fn secret_binary_empty_and_oversized_files_are_refused() {
        assert!(matches!(
            prompt(&file(".env")),
            Err(AiError::Invalid { .. })
        ));
        let mut binary = file("a.bin");
        binary.binary = true;
        assert!(matches!(prompt(&binary), Err(AiError::Invalid { .. })));
        let mut plain = file("a.txt");
        plain.segments.truncate(1);
        assert!(matches!(prompt(&plain), Err(AiError::Invalid { .. })));
        let mut big = file("big.txt");
        big.segments[1] = ConflictSegment::Conflict {
            current: vec!["x".repeat(70 * 1024)],
            incoming: vec![],
            base: None,
        };
        assert!(matches!(prompt(&big), Err(AiError::Invalid { .. })));
    }

    const VALID: &str = r#"{"regions":[
        {"index":1,"text":"","rationale":"drop it"},
        {"index":0,"text":"merged\nlines\n","rationale":" both "}]}"#;

    #[test]
    fn a_complete_reply_is_ordered_by_region_with_one_trailing_newline_removed() {
        let proposal = parse("P", VALID, 2).unwrap();
        assert_eq!(proposal.regions[0].index, 0);
        assert_eq!(proposal.regions[0].text, "merged\nlines");
        assert_eq!(proposal.regions[0].rationale, "both");
        assert_eq!(proposal.regions[1].text, "");
    }

    fn reason(reply: &str, regions: usize) -> String {
        match parse("P", reply, regions).unwrap_err() {
            AiError::InvalidResponse { reason, .. } => reason,
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn every_violation_is_named() {
        assert!(reason(r#"{"regions":[]}"#, 1).contains("no proposal"));
        assert!(
            reason(r#"{"regions":[{"index":3,"text":"","rationale":""}]}"#, 1)
                .contains("does not exist")
        );
        assert!(reason(r#"{"regions":[{"index":0,"text":"","rationale":""},{"index":0,"text":"","rationale":""}]}"#, 1).contains("twice"));
        assert!(reason(
            r#"{"regions":[{"index":0,"text":"a\n=======\nb","rationale":""}]}"#,
            1
        )
        .contains("markers"));
        assert!(reason(
            r#"{"regions":[{"index":0,"text":"<<<<<<< x","rationale":""}]}"#,
            1
        )
        .contains("markers"));
        assert!(reason(r#"{"regions":[{"index":0,"text":"x"}]}"#, 1).contains("rationale"));
        assert!(
            reason(r#"{"regions":[{"index":-1,"text":"x","rationale":""}]}"#, 1)
                .contains("invalid")
        );
        assert!(reason("nope", 1).contains("JSON"));
    }
}
