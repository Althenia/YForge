import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> };
type Job = { needs?: string | string[]; if?: string; permissions?: Record<string, string>; steps: Step[]; strategy?: { matrix: { include: Array<{ target: string }> } } };
const workflow = parse(readFileSync(resolve(root, ".github/workflows/build.yml"), "utf8")) as { permissions: Record<string, string>; jobs: Record<string, Job> };
const version = JSON.parse(readFileSync(resolve(root, "app/package.json"), "utf8")) as { version: string; devDependencies: Record<string, string> };
const dependencies = (job: Job) => typeof job.needs === "string" ? [job.needs] : job.needs ?? [];
const requiredJob = (name: string) => {
  const job = workflow.jobs[name];
  assert(job, `Missing release job: ${name}`);
  return job;
};

describe("release gates", () => {
  it("declares the browser tooling used by the maintained regression scripts", () => {
    expect(version.devDependencies["playwright-core"]).toBe("1.63.0");
  });

  it("names existing test files in every focused verification check", () => {
    const script = requiredJob("verify").steps.find((step) => step.name === "Verify frontend and release contracts")?.run;
    const command = script?.split("\n").find((line) => line.startsWith("pnpm vitest run "));
    assert(command);
    for (const file of command.trim().split(/\s+/).slice(3)) {
      expect(existsSync(resolve(root, "app", file)), `Missing verification test: ${file}`).toBe(true);
    }
  });

  it("pins every external action and defaults to read-only repository access", () => {
    expect(workflow.permissions.contents).toBe("read");
    const actions = Object.values(workflow.jobs).flatMap((job) => job.steps.flatMap((step) => step.uses ?? []));
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) expect(action).toMatch(/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
  });

  it("keeps a release draft until verification and both architecture builds succeed", () => {
    const prepare = requiredJob("prepare");
    const build = requiredJob("build");
    const publish = requiredJob("publish");
    requiredJob("verify");
    expect(dependencies(prepare)).toContain("verify");
    expect(dependencies(build)).toEqual(expect.arrayContaining(["verify", "prepare"]));
    expect(dependencies(publish)).toEqual(expect.arrayContaining(["prepare", "build"]));
    expect(build.strategy?.matrix.include.map((item) => item.target).sort()).toEqual(["aarch64-apple-darwin", "x86_64-apple-darwin"]);
    expect(prepare.steps.map((step) => step.run).join("\n")).toContain("--draft");
    expect(build.steps.find((step) => step.uses?.startsWith("tauri-apps/tauri-action@"))?.with?.releaseDraft).toBe(true);
    expect(publish.if).toContain("needs.prepare.result == 'success'");
    expect(publish.if).toContain("needs.build.result == 'success'");
    const verification = publish.steps.findIndex((step) => step.name === "Verify transferred release assets");
    const publication = publish.steps.findIndex((step) => step.name === "Publish the verified release");
    expect(verification).toBeGreaterThanOrEqual(0);
    expect(publication).toBeGreaterThan(verification);
  });

  it("allows manual preparation without allowing manual publication", () => {
    for (const name of ["prepare", "publish"]) {
      expect(requiredJob(name).if).toContain("github.event_name == 'push'");
      expect(requiredJob(name).if).toContain("startsWith(github.ref, 'refs/tags/v')");
    }
    expect(requiredJob("build").steps.find((step) => step.uses?.startsWith("tauri-apps/tauri-action@"))?.with?.tagName).toContain("github.event_name == 'push'");
  });

  it("reads the authenticated draft listing before checking release assets", () => {
    const script = requiredJob("publish").steps.find((step) => step.name === "Verify transferred release assets")?.run;
    expect(script).toContain('--paginate --jq');
    expect(script).not.toContain('--slurp');
    expect(script).toContain('select(.tag_name == env.GITHUB_REF_NAME)');
    expect(script).not.toContain('/releases/tags/');
  });

  it("accepts matching metadata and refuses a tag that does not match the app version", () => {
    const script = workflow.jobs.verify?.steps.find((step) => step.name === "Check release version metadata")?.run;
    assert(typeof script === "string", "Missing release version guard");
    const run = (tag: string) => spawnSync("bash", ["-e", "-c", script], { cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_EVENT_NAME: "push", GITHUB_REF: `refs/tags/${tag}`, GITHUB_REF_NAME: tag } });
    expect(run(`v${version.version}`).status).toBe(0);
    const mismatched = run("v999.0.0");
    expect(mismatched.status).not.toBe(0);
    expect(mismatched.stderr).toContain("does not match");
  });
});
