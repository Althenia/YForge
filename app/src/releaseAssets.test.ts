import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../../scripts/verify-release-assets.py");
const version = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")) as { version: string };
const directories: string[] = [];
type Asset = { name: string; state: string; size: number; digest: string; url: string };

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), "yforge-release-assets-"));
  directories.push(directory);
  const assets: Asset[] = [];
  const platforms: Record<string, { url: string; signature: string }> = {};
  const put = (name: string, text: string) => {
    writeFileSync(resolve(directory, name), text);
    const index = assets.findIndex((asset) => asset.name === name);
    const next = { name, state: "uploaded", size: Buffer.byteLength(text), digest: `sha256:${createHash("sha256").update(text).digest("hex")}`, url: `https://api.github.com/repos/Althenia/YForge/releases/assets/${1000 + (index < 0 ? assets.length : index)}` };
    if (index < 0) assets.push(next);
    else assets[index] = next;
    return next;
  };
  for (const [platform, arch] of [["darwin-aarch64", "aarch64"], ["darwin-x86_64", "x64"]] as const) {
    const name = `YForge_${version.version}_${arch}.app.tar.gz`;
    const signature = `synthetic-signature-${arch}`;
    const archive = put(name, `synthetic archive ${arch}`);
    put(`${name}.sig`, signature);
    put(`YForge_${version.version}_${arch}.dmg`, `synthetic disk image ${arch}`);
    platforms[platform] = { url: archive.url, signature };
    platforms[`${platform}-app`] = { ...platforms[platform] };
  }
  const updater = { version: version.version, platforms };
  put("latest.json", JSON.stringify(updater));
  const manifest = { tag_name: `v${version.version}`, draft: true, assets };
  const run = () => {
    const path = resolve(directory, "release.json");
    writeFileSync(path, JSON.stringify(manifest));
    return spawnSync("python3", [script, version.version, path, directory], { encoding: "utf8" });
  };
  return { directory, assets, updater, manifest, put, run };
}

describe("transferred release assets", () => {
  it("accepts both complete Mac builds and their matching updater metadata", () => {
    const result = fixture().run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("both Mac builds");
  });

  it("refuses a missing architecture artifact", () => {
    const data = fixture();
    data.assets.splice(data.assets.findIndex((asset) => asset.name.endsWith("_x64.dmg")), 1);
    const result = data.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("both complete Mac builds");
  });

  it("refuses bytes changed after the upload digest was recorded", () => {
    const data = fixture();
    const name = `YForge_${version.version}_x64.dmg`;
    const bytes = readFileSync(resolve(data.directory, name));
    const first = bytes[0];
    assert(first !== undefined);
    bytes[0] = first ^ 1;
    writeFileSync(resolve(data.directory, name), bytes);
    const result = data.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("digest does not match");
  });

  it("refuses updater metadata for another version", () => {
    const data = fixture();
    data.updater.version = "999.0.0";
    data.put("latest.json", JSON.stringify(data.updater));
    const result = data.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Updater version does not match");
  });

  it.each(["darwin-aarch64", "darwin-aarch64-app"])("refuses a different updater signature for %s", (platform) => {
    const data = fixture();
    const entry = data.updater.platforms[platform];
    assert(entry);
    entry.signature = "another-signature";
    data.put("latest.json", JSON.stringify(data.updater));
    const result = data.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("signature does not match");
  });

  it("refuses an updater URL pointing to another repository", () => {
    const data = fixture();
    const entry = data.updater.platforms["darwin-aarch64"];
    assert(entry);
    entry.url = entry.url.replace("Althenia/YForge", "Elsewhere/Other");
    data.put("latest.json", JSON.stringify(data.updater));
    const result = data.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Updater URL does not match");
  });

  it("refuses to republish an already public release", () => {
    const data = fixture();
    data.manifest.draft = false;
    const result = data.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("matching draft");
  });
});
