/**
 * The outcome of a cuisctl command.
 *
 * A command produces a single `Result`. The process exit code and the JSON
 * and text renderings are all pure functions of it, so the reported outcome
 * and the exit code cannot disagree.
 */

import type { DestroyView } from './commands/destroy.js';
import type { StartView } from './commands/start.js';
import type { InstanceView, StatusList } from './commands/status.js';
import type { StopView } from './commands/stop.js';
import type { ErrorKind } from './errors.js';

export type Result =
  | { ok: true; command: string; data: unknown }
  | { ok: false; error: { kind: ErrorKind; message: string; hint?: string } };

/**
 * Maps a `Result` to a process exit code: 0 on success, 2 on a usage error,
 * 1 on any other failure.
 */
export function exitCode(result: Result): number {
  if (result.ok) return 0;
  return result.error.kind === 'usage' ? 2 : 1;
}

/** Renders a `Result` as the full stdout text for `--json` mode. */
export function renderJson(result: Result): string {
  return JSON.stringify(result) + '\n';
}

/**
 * Renders a `Result` as the full stdout text for text mode.
 *
 * Errors render as an `error: <message>` line, followed by a `hint: <hint>`
 * line when the error carries a hint. A `create` result renders as a
 * "Created instance" summary with its state and paths. A `status` result for
 * one instance renders its state, the runtime details present, and paths.
 * A status list renders a "Cuis home:" header and one aligned line per
 * instance (or "No instances."). A `start` result renders "<name>: running"
 * or "<name>: already running", then the runtime details and paths. A `stop`
 * result renders "<name>: stopped, saved", "<name>: stopped, not saved" or
 * "<name>: already stopped". A `reset` result renders "<name>: reset to the
 * pristine base (Cuis <key>); user files kept" followed by paths. A `destroy`
 * result renders "<name>: destroyed (removed <folder>, including its user
 * files)". Results of unknown commands are not rendered and produce an empty
 * string.
 */
export function renderText(result: Result): string {
  if (!result.ok) return renderError(result.error);
  switch (result.command) {
    case 'create':
      return renderCreate(result.data as InstanceView);
    case 'status':
      return 'instances' in (result.data as object)
        ? renderList(result.data as StatusList)
        : renderInstance(result.data as InstanceView);
    case 'start':
      return renderStart(result.data as StartView);
    case 'stop':
      return renderStop(result.data as StopView);
    case 'reset':
      return renderReset(result.data as InstanceView);
    case 'destroy':
      return renderDestroy(result.data as DestroyView);
    default:
      return '';
  }
}

function renderStop(view: StopView): string {
  if (view.outcome === 'already_stopped') return `${view.name}: already stopped\n`;
  return `${view.name}: ${view.saved ? 'stopped, saved' : 'stopped, not saved'}\n`;
}

function renderReset(view: InstanceView): string {
  return `${view.name}: reset to the pristine base (Cuis ${view.cuisKey}); user files kept\n` + pathLines(view.paths);
}

function renderDestroy(view: DestroyView): string {
  return `${view.name}: destroyed (removed ${view.removed.instance}, including its user files)\n`;
}

const STATE_LABEL = { stopped: 'stopped', running: 'running', running_untracked: 'running (untracked)' };

function renderInstance(view: InstanceView): string {
  return `${view.name}: ${STATE_LABEL[view.state]} (Cuis ${view.cuisKey})\n` + detailAndPathLines(view);
}

function renderStart(view: StartView): string {
  return `${view.name}: ${view.alreadyRunning ? 'already running' : 'running'}\n` + detailAndPathLines(view);
}

function detailAndPathLines(view: InstanceView): string {
  const optional: Array<[string, string | number | undefined]> = [
    ['  pid:    ', view.pid],
    ['  mode:   ', view.mode],
    ['  bridge: ', view.bridge === undefined ? undefined : view.bridge ? 'on' : 'off'],
    [
      '  save on stop: ',
      view.saveOnStop === undefined ? undefined : view.saveOnStop ? 'available' : 'unavailable',
    ],
    ['  started: ', view.startedAt],
  ];
  const details = optional
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => `${label}${value}\n`)
    .join('');
  return details + pathLines(view.paths);
}

function renderList(list: StatusList): string {
  const { home, instances } = list;
  const failure = home.state === 'failed' && home.error ? ` (${home.error.kind}: ${home.error.message})` : '';
  const header = `Cuis home: ${home.state}${failure}\n`;
  if (instances.length === 0) return header + 'No instances.\n';
  const width = Math.max(...instances.map((i) => i.name.length)) + 2;
  return header + instances.map((i) => `${i.name.padEnd(width)}${listState(i)}\n`).join('');
}

function listState(view: InstanceView): string {
  if (view.state === 'running') return `running (pid ${view.pid})`;
  if (view.state === 'running_untracked') return `running (untracked, pid ${view.pid})`;
  return 'stopped';
}

function pathLines(paths: InstanceView['paths']): string {
  return `  folder: ${paths.instance}\n  files:  ${paths.files}\n  log:    ${paths.log}\n`;
}

function renderError(error: { message: string; hint?: string }): string {
  const hint = error.hint === undefined ? '' : `hint: ${error.hint}\n`;
  return `error: ${error.message}\n${hint}`;
}

function renderCreate(view: InstanceView): string {
  return (
    `Created instance ${view.name} (Cuis ${view.cuisKey})\n` +
    `  state:  ${view.state}\n` +
    pathLines(view.paths)
  );
}
