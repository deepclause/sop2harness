#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { checkCommand } from "./commands/check.js";
import { listCommand } from "./commands/list.js";
import { statusCommand } from "./commands/status.js";
import { createCommand } from "./commands/create.js";
import { commitCommand } from "./commands/commit.js";
import { exportCommand } from "./commands/export.js";
import * as ui from "./ui.js";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

function stub(command: string, phase: string): number {
  ui.error(`${command} is not implemented yet (roadmap ${phase}).`);
  ui.info("See docs/DESIGN.md for the planned behaviour.");
  return 1;
}

async function run(action: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await action();
  } catch (error) {
    ui.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const program = new Command();

program
  .name("s2h")
  .description("Turn Standard Operating Procedures into a runnable, versioned DeepClause DML harness.")
  .version(packageJson.version);

program
  .command("init")
  .description("Scaffold an s2h project")
  .option("--name <name>", "project/harness name (defaults to the directory name)")
  .option("--model <provider/id>", "default model for authoring")
  .option("--force", "re-initialize, overwriting s2h.json and harness.json")
  .action(async (options: { name?: string; model?: string; force?: boolean }) => {
    await run(() => initCommand(process.cwd(), options));
  });

program
  .command("create")
  .description("Author or update a harness from a prompt and/or SOP files")
  .argument("[request]", "natural-language description of the SOP/harness")
  .option("--file <path...>", "SOP files or directories to ingest")
  .option("--name <slug>", "name for the authored skill set")
  .option("--update", "regenerate generated files")
  .option("--model <provider/id>", "model override")
  .option("--context <mode>", "turn, branch, or isolated")
  .option("--headless", "disable interactive prompts")
  .option("--json", "emit machine-readable progress")
  .option("--debug", "enable debug output")
  .action(async (request: string | undefined, options: {
    file?: string[];
    name?: string;
    update?: boolean;
    model?: string;
    context?: string;
    headless?: boolean;
    json?: boolean;
    debug?: boolean;
  }) => {
    await run(() =>
      createCommand(process.cwd(), {
        request,
        files: options.file,
        name: options.name,
        update: options.update,
        model: options.model,
        context: options.context,
        headless: options.headless,
        json: options.json,
        debug: options.debug,
      }),
    );
  });

program
  .command("commit")
  .description("Validate, version, and tag the harness")
  .option("-m, --message <message>", "commit message")
  .option("--major", "bump the major version")
  .option("--minor", "bump the minor version")
  .option("--patch", "bump the patch version (default)")
  .option("--no-tag", "do not create a git tag")
  .option("--dry-run", "print the plan without committing")
  .action(async (options: {
    message?: string;
    major?: boolean;
    minor?: boolean;
    patch?: boolean;
    tag?: boolean;
    dryRun?: boolean;
  }) => {
    await run(() =>
      commitCommand(process.cwd(), {
        message: options.message,
        major: options.major,
        minor: options.minor,
        patch: options.patch,
        tag: options.tag,
        dryRun: options.dryRun,
      }),
    );
  });

program
  .command("export")
  .description("Generate a runnable API + web app + Dockerfile")
  .option("--out <dir>", "output directory", "./export")
  .option("--tag <version>", "export a tagged version")
  .option("--llm <backend>", "pi or openai-compatible")
  .option("--sandbox <provider>", "agentvm or none")
  .option("--no-mcp", "omit the MCP server")
  .option("--no-web", "omit the web chat app")
  .option("--allow-effects", "allow skills that declare effects")
  .option("--port <n>", "default port")
  .action(async (options: {
    out?: string;
    tag?: string;
    llm?: string;
    sandbox?: string;
    mcp?: boolean;
    web?: boolean;
    allowEffects?: boolean;
    port?: string;
  }) => {
    await run(() =>
      exportCommand(process.cwd(), {
        out: options.out,
        tag: options.tag,
        llm: options.llm,
        sandbox: options.sandbox,
        mcp: options.mcp,
        web: options.web,
        allowEffects: options.allowEffects,
        port: options.port,
      }),
    );
  });

program
  .command("list")
  .description("List skills, SOPs, and versions")
  .option("--json", "emit JSON")
  .action(async (options: { json?: boolean }) => {
    await run(() => listCommand(process.cwd(), options));
  });

program
  .command("status")
  .description("Show project, harness, and version state")
  .option("--json", "emit JSON")
  .action(async (options: { json?: boolean }) => {
    await run(() => statusCommand(process.cwd(), options));
  });

program
  .command("check")
  .description("Validate the harness without changing it")
  .action(async () => {
    await run(() => checkCommand(process.cwd()));
  });

program
  .command("run")
  .description("Run a harness skill locally (debug aid)")
  .argument("<skill>", "skill id or path")
  .argument("[args...]", "skill arguments")
  .option("--context <mode>", "turn, branch, or isolated")
  .option("--debug", "enable debug output")
  .action(() => {
    process.exitCode = stub("run", "Phase 4");
  });

program
  .command("config")
  .description("Read or write project configuration")
  .argument("<action>", "get, set, or list")
  .argument("[key]", "config key")
  .argument("[value]", "config value")
  .action(() => {
    process.exitCode = stub("config", "Phase 1 (planned helper)");
  });

program
  .command("doctor")
  .description("Check environment, model auth, and tool availability")
  .action(() => {
    process.exitCode = stub("doctor", "Phase 1 (planned helper)");
  });

await program.parseAsync(process.argv);
