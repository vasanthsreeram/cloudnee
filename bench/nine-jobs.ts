import { runNineJobs } from "./jobs.ts";

const reports = await runNineJobs();
const width = Math.max(...reports.map((report) => report.name.length));
console.log("");
console.log("cloudnee  ·  nine jobs on D1 + an in-process Vectorize");
console.log("SQLite stands in for D1. Vectors lag the way a fresh Vectorize upsert can.");
console.log("");
console.log(`${"job".padEnd(width)}  ms      result`);
console.log(`${"-".repeat(width)}  ------  ------`);
for (const report of reports) {
  const mark = report.pass ? "pass" : "FAIL";
  console.log(`${report.name.padEnd(width)}  ${String(report.ms).padStart(6)}  ${mark}  ${report.detail}`);
}
console.log("");
const failed = reports.filter((report) => !report.pass);
if (failed.length) {
  console.error(`${failed.length} job${failed.length === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log(`${reports.length} jobs passed`);
