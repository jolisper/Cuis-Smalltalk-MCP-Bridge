#!/usr/bin/env node
/**
 * Process entry for cuisctl: wires runCli to argv, env, stdout and stderr.
 * Sets process.exitCode instead of calling process.exit() so stdout flushes.
 * Never reads stdin. Progress messages go to stderr; stdout carries exactly
 * one document (runCli's result). The test-only CUISCTL_HOME override is read
 * inside runCli from the env passed here, not in this file.
 */
import { runCli } from './runCli.js';

const { stdout, exitCode } = await runCli(process.argv.slice(2), {
  env: process.env,
  platform: process.platform,
  onProgress: (m) => process.stderr.write(m + '\n'),
});
process.stdout.write(stdout);
process.exitCode = exitCode;
