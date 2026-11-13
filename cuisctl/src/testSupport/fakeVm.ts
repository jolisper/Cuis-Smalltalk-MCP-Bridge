import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function fakeShScript(body: string): string {
  return '#!fake-sh\n' + body;
}

// Invocation contract (same as the real VM): <vm> -headless <image> -s <script> [extra args...]
// Extra trailing args (e.g. -ApplePersistenceIgnoreState YES) are ignored.
const VM_SCRIPT = `#!/bin/sh
INVOCATION_LOG
image="$2"
script="$4"
first=$(head -n 1 "$script")
if [ "$first" = "#!fake-sh" ]; then
  FAKE_IMAGE="$image"
  export FAKE_IMAGE
  sh "$script"
  exit $?
fi
BOOT_BEHAVIOR
`;

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export async function writeFakeVm(
  filePath: string,
  opts: {
    bootFails?: boolean;
    markerPrefix?: string;
    requireRealVmScript?: boolean;
    writesUserChanges?: boolean;
    invocationLog?: string;
    running?: boolean;
  } = {},
): Promise<void> {
  // The real VM prints nothing unless the Transcript is logged to stdout and the marker line is ended with newLine.
  const userChanges = opts.writesUserChanges
    ? `mkdir -p UserChanges\necho x > UserChanges/Cuis7.8.user.changes\n`
    : '';
  // tsc does not copy .mjs files, so always point at the source copy (works from src/ and dist/).
  const runningVm = fileURLToPath(new URL('../../src/testSupport/fakeRunningVm.mjs', import.meta.url));
  const boot = userChanges + (opts.running
    ? `exec -a Squeak node ${shQuote(runningVm)} "$@"`
    : opts.bootFails
    ? `echo 'fake VM: cannot boot' >&2\nexit 3`
    : opts.requireRealVmScript
      ? `if grep -qF "Transcript logToStdout: true" "$script" && grep -qF "Transcript show: 'DONE exitCode=0'; newLine" "$script"; then echo 'DONE exitCode=0'; fi\nexit 0`
      : `echo 'DONE exitCode=0'\nexit 0`);
  // One line per invocation: argv=<$0 and all args, space-joined> cwd=<pwd>
  const log = opts.invocationLog
    ? `echo "argv=$0 $* cwd=$(pwd)" >> ${shQuote(opts.invocationLog)}`
    : '';
  // Scripts print the marker as: echo "$FAKE_MARKER_PREFIX""DONE exitCode=0"
  const prefix = (opts.markerPrefix ?? '').replace(/'/g, `'\\''`);
  const vm = VM_SCRIPT.replace('INVOCATION_LOG', log)
    .replace('BOOT_BEHAVIOR', boot)
    .replace(
      '  export FAKE_IMAGE\n',
      `  export FAKE_IMAGE\n  FAKE_MARKER_PREFIX='${prefix}'\n  export FAKE_MARKER_PREFIX\n`,
    );
  await fs.writeFile(filePath, vm);
  await fs.chmod(filePath, 0o755);
}

export async function writeFakeVmConfig(imageDir: string, config: Record<string, unknown>): Promise<void> {
  await fs.writeFile(path.join(imageDir, 'fake-vm.json'), JSON.stringify(config));
}
