/**
 * The cuisctl `status` command. Strictly read-only: no mkdir, writes, locks or signals.
 *   - named instance: readInstance + state detection, rendered as an
 *     InstanceView for all states (stopped, running, running_untracked)
 *   - no name: a StatusList with the HomeView and the view of every instance
 * stoppedView is exported for `create`, which only needs a fresh instance's view.
 */
import { homeStatus } from '../home.js';
import { listInstances, readInstance, validateName } from '../instance.js';
import type { InstanceRecord } from '../instance.js';
import { instancePaths } from '../paths.js';
import { instanceState } from '../state.js';
import type { InstanceState } from '../state.js';
import type { Result } from '../output.js';
import { errorResult } from './errorResult.js';

export interface StatusOptions {
  home: string;
  name?: string;
}

/** Runs the status flow; never rejects, failures are returned as an error Result. */
export async function runStatus(opts: StatusOptions): Promise<Result> {
  try {
    const data = opts.name !== undefined ? await statusOf(opts.home, opts.name) : await statusList(opts.home);
    return { ok: true, command: 'status', data };
  } catch (e) {
    return errorResult(e);
  }
}

async function statusOf(home: string, name: string): Promise<InstanceView> {
  validateName(name);
  const record = await readInstance(home, name);
  return viewOf(home, record, await instanceState(home, name));
}

async function statusList(home: string): Promise<StatusList> {
  const status = await homeStatus({ home });
  const homeView: HomeView =
    status.state === 'failed' ? { state: status.state, error: status.error } : { state: status.state };
  const instances = await Promise.all(
    (await listInstances(home)).map(async (record) =>
      viewOf(home, record, await instanceState(home, record.name)),
    ),
  );
  return { home: homeView, instances };
}

export interface HomeView {
  state: 'missing' | 'ready' | 'preparing' | 'failed';
  error?: { kind: string; message: string };
}

export interface StatusList {
  home: HomeView;
  instances: InstanceView[];
}

export interface InstanceView {
  name: string;
  cuisKey: string;
  createdAt: string;
  state: 'stopped' | 'running' | 'running_untracked';
  pid?: number;
  mode?: 'gui' | 'headless';
  bridge?: boolean;
  saveOnStop?: boolean;
  startedAt?: string;
  paths: { instance: string; files: string; log: string };
}

/** The view of an instance that is not running. */
export function stoppedView(home: string, record: InstanceRecord): InstanceView {
  return viewOf(home, record, { state: 'stopped' });
}

/** The view of an instance in its current detected state. */
export async function instanceView(home: string, record: InstanceRecord): Promise<InstanceView> {
  return viewOf(home, record, await instanceState(home, record.name));
}

function viewOf(home: string, record: InstanceRecord, state: InstanceState): InstanceView {
  const { name, cuisKey, createdAt } = record;
  const p = instancePaths(home, name);
  const paths = { instance: p.dir, files: p.files, log: p.vmLog };
  if (state.state === 'running') {
    const { pid, mode, bridge, saveOnStop, startedAt } = state;
    return { name, cuisKey, createdAt, state: 'running', pid, mode, bridge, saveOnStop, startedAt, paths };
  }
  if (state.state === 'running_untracked') {
    return { name, cuisKey, createdAt, state: 'running_untracked', pid: state.pid, paths };
  }
  return { name, cuisKey, createdAt, state: 'stopped', paths };
}
