import { spawn } from "node:child_process";

export interface Command {
  readonly executable: string;
  readonly args: readonly string[];
}

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export type CommandRunner = (command: Command) => Promise<CommandResult>;

export const runCommand: CommandRunner = async ({ executable, args }) =>
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => reject(new Error(`Unable to start ${executable}: ${error.message}`)));
    child.on("close", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const status = signal === null ? `exit ${String(code)}` : `signal ${signal}`;
        reject(new Error(`${executable} failed (${status})${stderr === "" ? "" : `: ${stderr.trim()}`}`));
      }
    });
  });
