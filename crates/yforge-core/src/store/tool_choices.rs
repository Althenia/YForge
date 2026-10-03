use std::path::Path;

use super::{open, parse, put_setting, read_settings, sql, stored_values};
use crate::error::CoreError;
use crate::external_tools::{default_choices, validate_choices, ToolChoices};

const MERGE: &str = "tools.merge_tool";
const DIFF: &str = "tools.diff_tool";
const EDITOR: &str = "tools.editor";

pub fn tool_choices_load(dir: &Path) -> Result<ToolChoices, CoreError> {
    let conn = open(dir)?;
    let defaults = default_choices(&read_settings(&conn, dir)?);
    let stored = stored_values(&conn, "SELECT key, value FROM settings", []).map_err(sql(dir))?;
    Ok(ToolChoices {
        merge: parse(dir, &stored, MERGE, defaults.merge)?,
        diff: parse(dir, &stored, DIFF, defaults.diff)?,
        editor: parse(dir, &stored, EDITOR, defaults.editor)?,
    })
}

pub fn tool_choices_save(dir: &Path, choices: &ToolChoices) -> Result<(), CoreError> {
    validate_choices(choices)?;
    let mut conn = open(dir)?;
    let tx = conn.transaction().map_err(sql(dir))?;
    put_setting(&tx, MERGE, &choices.merge)
        .and_then(|()| put_setting(&tx, DIFF, &choices.diff))
        .and_then(|()| put_setting(&tx, EDITOR, &choices.editor))
        .map_err(sql(dir))?;
    tx.commit().map_err(sql(dir))
}
