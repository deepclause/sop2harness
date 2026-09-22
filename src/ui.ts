import pc from "picocolors";

export function info(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function ok(message: string): void {
  process.stdout.write(`${pc.green("✓")} ${message}\n`);
}

export function warn(message: string): void {
  process.stdout.write(`${pc.yellow("!")} ${message}\n`);
}

export function error(message: string): void {
  process.stderr.write(`${pc.red("✗")} ${message}\n`);
}

export function section(title: string): void {
  process.stdout.write(`\n${pc.bold(title)}\n`);
}
