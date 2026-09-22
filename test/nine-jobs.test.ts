import assert from "node:assert/strict";
import test from "node:test";
import { runNineJobs } from "../bench/jobs.ts";

test("nine memory jobs", async () => {
  const reports = await runNineJobs();
  for (const report of reports) {
    assert.equal(report.pass, true, `${report.name}: ${report.detail}`);
  }
  assert.equal(reports.length, 9);
});
