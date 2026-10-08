import { spawn } from "node:child_process";
import { pythonRuntime } from "./python-runtime.mjs";
try {
  const { command, args } = pythonRuntime();
  const child = spawn(command, [...args, ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  child.on("error", (e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
