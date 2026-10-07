import hashlib
import json
import pathlib
import re
import sys


def verify(version: str, manifest_path: str, directory: str) -> None:
    if re.fullmatch(r"\d+\.\d+\.\d+", version) is None:
        raise ValueError("Invalid release version")
    manifest = json.loads(pathlib.Path(manifest_path).read_text())
    if manifest.get("draft") is not True or manifest.get("tag_name") != f"v{version}":
        raise ValueError("Release must be the matching draft")
    names = {"latest.json"}
    for arch in ("aarch64", "x64"):
        archive = f"YForge_{version}_{arch}.app.tar.gz"
        names.update((archive, f"{archive}.sig", f"YForge_{version}_{arch}.dmg"))
    assets = manifest["assets"]
    by_name = {asset["name"]: asset for asset in assets}
    actual = [asset["name"] for asset in assets]
    if len(actual) != len(set(actual)) or set(actual) != names:
        raise ValueError("Release assets must contain both complete Mac builds")
    directory = pathlib.Path(directory)
    for asset in assets:
        name = asset["name"]
        if pathlib.Path(name).name != name or asset.get("state") != "uploaded":
            raise ValueError("Release asset is not an uploaded file")
        path = directory / name
        if not path.is_file() or path.stat().st_size != asset["size"] or asset["size"] <= 0:
            raise ValueError(f"Release asset size does not match: {name}")
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        if asset.get("digest") != f"sha256:{digest.hexdigest()}":
            raise ValueError(f"Release asset digest does not match: {name}")
    updater = json.loads((directory / "latest.json").read_text())
    if updater.get("version") != version:
        raise ValueError("Updater version does not match")
    for platform, arch in (
        ("darwin-aarch64", "aarch64"),
        ("darwin-aarch64-app", "aarch64"),
        ("darwin-x86_64", "x64"),
        ("darwin-x86_64-app", "x64"),
    ):
        entry = updater["platforms"][platform]
        archive = f"YForge_{version}_{arch}.app.tar.gz"
        if entry["url"] != by_name[archive]["url"]:
            raise ValueError("Updater URL does not match the release asset")
        if entry.get("signature") != (directory / f"{archive}.sig").read_text().strip():
            raise ValueError("Updater signature does not match the uploaded signature")
    print(f"Verified v{version}: both Mac builds and updater metadata")


if __name__ == "__main__":
    try:
        verify(*sys.argv[1:])
    except (ValueError, KeyError, OSError, TypeError) as error:
        print(f"Release asset verification failed: {error}", file=sys.stderr)
        raise SystemExit(1)
