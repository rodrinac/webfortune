// Bridge aws login to providers that predate AWS sign-in support.
// Credentials exist only in the child environment; never print or save them.
import { spawnSync } from "node:child_process";
const result = spawnSync(
  "aws",
  ["configure", "export-credentials", "--format", "process"],
  { encoding: "utf8" },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status || 1);
}
const credentials = JSON.parse(result.stdout);
const terraform = spawnSync("terraform", process.argv.slice(2), {
  stdio: "inherit",
  env: {
    ...process.env,
    AWS_ACCESS_KEY_ID: credentials.AccessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey,
    AWS_SESSION_TOKEN: credentials.SessionToken,
  },
});
if (terraform.error) throw terraform.error;
process.exit(terraform.status ?? 1);
