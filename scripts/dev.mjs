import { spawn } from "node:child_process";
import { pythonRuntime } from "./python-runtime.mjs";
let runtime;
try {
  runtime = pythonRuntime();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const children = [
  spawn(runtime.command, [...runtime.args, "server/app.py"], {
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0"],
    { stdio: "inherit" },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 200).unref();
}
for (const child of children) {
  child.on("error", (err) => {
    console.error(err.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code || 0);
  });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
