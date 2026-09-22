import { mkdir } from "node:fs/promises";

const AGENTVM_MODULE = "deepclause-agentvm";

export interface SandboxConfig {
  wasmPath: string;
  harnessRoot: string;
  scratchDir: string;
  timeoutMs: number;
  maxOutputBytes: number;
  network: boolean;
  allow: string[];
  networkRateLimit: number;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * One long-lived AgentVM per session, started lazily on the first shell call
 * and stopped on session disposal (ADR-0001). The `deepclause-agentvm` import
 * is dynamic and untyped so shell-free exports never load the dependency.
 */
export class Sandbox {
  private vm: unknown = null;

  constructor(private readonly config: SandboxConfig) {}

  async exec(command: string): Promise<CommandResult> {
    const vm = await this.ensure();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;

    try {
      const result = await new Promise<CommandResult>((resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(`sandbox command timed out after ${this.config.timeoutMs}ms`));
        }, this.config.timeoutMs);
        (vm as { exec: (command: string) => Promise<CommandResult> }).exec(command).then(resolve, reject);
      });

      if (result.stdout.length > this.config.maxOutputBytes) {
        throw new Error("sandbox stdout exceeded the configured output limit");
      }
      if (result.stderr.length > this.config.maxOutputBytes) {
        throw new Error("sandbox stderr exceeded the configured output limit");
      }
      return result;
    } catch (error) {
      if (timedOut) await this.reset();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async dispose(): Promise<void> {
    await this.reset();
  }

  private async reset(): Promise<void> {
    if (!this.vm) return;
    const vm = this.vm as { stop: () => Promise<void> };
    this.vm = null;
    try {
      await vm.stop();
    } catch {
      // best-effort teardown
    }
  }

  private async ensure(): Promise<unknown> {
    if (this.vm) return this.vm;

    await mkdir(this.config.scratchDir, { recursive: true });

    const agentvm: { AgentVM: new (options: Record<string, unknown>) => unknown } = await import(AGENTVM_MODULE);
    const vm = new agentvm.AgentVM({
      wasmPath: this.config.wasmPath,
      mounts: {
        "/mnt/harness": this.config.harnessRoot,
        "/workspace": this.config.scratchDir,
      },
      network: false,
      networkRateLimit: this.config.networkRateLimit,
    });

    const start = (vm as { start: () => Promise<void> }).start;
    await start.call(vm);

    if (this.config.network && this.config.allow.length > 0) {
      const setNetworkEnabled = (vm as { setNetworkEnabled: (enabled: boolean) => void }).setNetworkEnabled;
      const setFirewall = (vm as { setFirewall: (config: { default: "deny"; rules: unknown[] }) => void }).setFirewall;
      setNetworkEnabled.call(vm, true);
      setFirewall.call(vm, { default: "deny", rules: this.allowRules() });
    }

    this.vm = vm;
    return vm;
  }

  private allowRules(): unknown[] {
    return this.config.allow.flatMap((entry) => {
      const [remote = "*", port = "*"] = entry.split(":");
      return [
        { direction: "out", protocol: "tcp", remote: remote || "*", port, action: "allow" },
        { direction: "out", protocol: "udp", remote: remote || "*", port, action: "allow" },
      ];
    });
  }
}
