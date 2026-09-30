use std::fs;
use std::io::ErrorKind;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use crate::error::CoreError;
use crate::model::CliInstall;
use crate::sqlite::failure;

const MARKER: &str = "# Installed by YForge";
const SCRIPT_NAME: &str = "yforge";

fn script(executable: &Path) -> String {
    let quoted = executable.display().to_string().replace('\'', "'\\''");
    format!("#!/bin/sh\n{MARKER}\nnohup '{quoted}' \"$@\" >/dev/null 2>&1 &\n")
}

fn replaced(target: &Path) -> Result<bool, CoreError> {
    let metadata = match fs::symlink_metadata(target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(failure(target, error)),
    };
    let ours = metadata.file_type().is_file()
        && fs::read_to_string(target).is_ok_and(|text| text.lines().nth(1) == Some(MARKER));
    if ours {
        Ok(true)
    } else {
        Err(CoreError::invalid_request(format!(
            "{} already exists and was not created by YForge; remove or rename it first",
            target.display()
        )))
    }
}

pub fn install_cli(directory: &Path, executable: &Path) -> Result<CliInstall, CoreError> {
    if !executable.is_absolute() || !executable.is_file() {
        return Err(CoreError::invalid_request(format!(
            "{} is not the path of an installed YForge executable",
            executable.display()
        )));
    }
    fs::create_dir_all(directory).map_err(|error| failure(directory, error))?;
    let target = directory.join(SCRIPT_NAME);
    let replaced = replaced(&target)?;
    let temporary = directory.join(format!(".{SCRIPT_NAME}.tmp-{}", std::process::id()));
    let written = fs::write(&temporary, script(executable))
        .and_then(|()| fs::set_permissions(&temporary, fs::Permissions::from_mode(0o755)))
        .and_then(|()| fs::rename(&temporary, &target));
    if let Err(error) = written {
        let _ = fs::remove_file(&temporary);
        return Err(failure(&target, error));
    }
    Ok(CliInstall {
        path: target.display().to_string(),
        replaced,
    })
}
