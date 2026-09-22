import { resolveProject } from "../project.js";
import { validateHarness } from "../harness/validate.js";
import * as ui from "../ui.js";

export async function checkCommand(cwd: string): Promise<number> {
  let project;
  try {
    project = await resolveProject(cwd);
  } catch (error) {
    ui.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  ui.section(`Validating ${project.config.name}`);
  const report = await validateHarness(project.paths);
  for (const message of report.errors) ui.error(message);
  for (const message of report.warnings) ui.warn(message);

  if (report.ok) {
    ui.ok("harness is valid");
    return 0;
  }
  ui.error(`harness is invalid: ${report.errors.length} error(s)`);
  return 1;
}
