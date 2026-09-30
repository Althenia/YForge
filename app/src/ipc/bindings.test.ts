import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const { UPDATE_BINDINGS: _update, ...checkEnv } = process.env;

it("committed bindings match the Rust types (cargo test -p yforge-core --test bindings)", () => {
  const result = spawnSync("cargo", ["test", "-p", "yforge-core", "--test", "bindings"], {
    cwd: resolve(import.meta.dirname, "../../.."),
    encoding: "utf8",
    env: checkEnv,
  });
  expect({ status: result.status, output: result.status === 0 ? "" : `${result.stdout}\n${result.stderr}` }).toEqual({
    status: 0,
    output: "",
  });
}, 300_000);
