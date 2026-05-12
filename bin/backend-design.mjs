#!/usr/bin/env node
import { mkdirSync, symlinkSync, unlinkSync, lstatSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");

function pathExists(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function install() {
  const skillsDir = join(homedir(), ".claude", "skills");
  const target = join(skillsDir, "backend-design");
  mkdirSync(skillsDir, { recursive: true });
  if (pathExists(target)) {
    unlinkSync(target);
    console.log(`removed existing: ${target}`);
  }
  symlinkSync(pkgRoot, target, "dir");
  console.log(`OK installed: ${target} -> ${pkgRoot}`);
  console.log("");
  console.log("Restart Claude Code (or start a new session). Then in any");
  console.log("React/Next.js project, run:");
  console.log("");
  console.log("  /backend-design");
}

function uninstall() {
  const target = join(homedir(), ".claude", "skills", "backend-design");
  if (pathExists(target)) {
    unlinkSync(target);
    console.log(`OK removed: ${target}`);
  } else {
    console.log("Not installed.");
  }
}

async function validate() {
  const mod = await import("../validate.mjs");
  process.exit(mod.printResults(mod.validate(process.cwd())));
}

const cmd = process.argv[2];
const cmds = { install, uninstall, validate };

if (!cmd || !cmds[cmd]) {
  console.error("backend-design - Claude Code skill installer");
  console.error("");
  console.error("Usage:");
  console.error("  backend-design install    Symlink SKILL.md into ~/.claude/skills/");
  console.error("  backend-design uninstall  Remove the symlink");
  console.error("  backend-design validate   Validate .backend-design/state/*.json in cwd");
  process.exit(cmd ? 1 : 0);
}

await cmds[cmd]();
