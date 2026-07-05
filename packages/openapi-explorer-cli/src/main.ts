#!/usr/bin/env node
import { dispatch } from "./cli/dispatch.ts";

async function main() {
  const output = await dispatch(process.argv);
  console.log(output);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
