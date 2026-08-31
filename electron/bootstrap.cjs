const { appendFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const executableDirectory = path.dirname(path.resolve(process.execPath));
const possibleTestRoot = path.dirname(executableDirectory);
const testRootName = path.basename(possibleTestRoot);
const isIsolatedUpdateTest =
  path.dirname(possibleTestRoot) === path.resolve(os.tmpdir()) &&
  testRootName.startsWith("janja-update-");
const inferredResult = isIsolatedUpdateTest
  ? path.join(
      possibleTestRoot,
      `janja-update-result-${testRootName.slice("janja-update-".length)}.jsonl`,
    )
  : null;

const recordBootstrap = (event, details = {}) => {
  if (!inferredResult) return;
  appendFileSync(
    inferredResult,
    `${JSON.stringify({ event, ...details })}\n`,
    "utf8",
  );
};

recordBootstrap("bootstrap");
import("./main.mjs").catch((error) => {
  recordBootstrap("bootstrap-error", {
    error: error instanceof Error ? error.stack : String(error),
  });
  process.exitCode = 1;
});
