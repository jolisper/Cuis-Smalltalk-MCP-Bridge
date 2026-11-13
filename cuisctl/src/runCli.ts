/**
 * CLI logic, kept testable: runCli holds argv parsing, the platform gate and
 * command dispatch; cli.ts is the thin process wiring around it.
 * It never reads stdin and never rejects: every failure is a Result.
 *
 * Output contract: stdout carries exactly one document (text, or JSON with
 * `--json`); progress goes to stderr through ctx.onProgress. `--json` is
 * accepted anywhere on the command line, including on a parse failure.
 * The options terminator `--` ends option parsing, so a name starting with
 * `-` reaches name validation instead of being rejected as an unknown option.
 *
 * Flags: `--json` is global; `--headless` and `--bridge` belong to start,
 * `--save` to stop, `--yes` to destroy. Each command's table entry declares
 * what it accepts.
 *
 * `execute` checks in this order, and the first failure wins:
 *   1. parse: malformed argv or unknown option
 *   2. command: present and known
 *   3. platform gate: macOS-only commands fail elsewhere
 *   4. flag check: a flag the command does not accept is an unknown option
 *   5. argument validation: name present (unless optional), no extras
 *   6. dispatch: the command's `run` does the work
 * The platform gate precedes validation so nothing runs on an unsupported
 * platform, not even name validation.
 *
 * Test seams: CUISCTL_HOME (read from ctx.env) overrides the home directory;
 * `platform`, `createOptions`, `startOptions` and
 * `stopOptions` are injected by tests, never by cli.ts.
 */
import { parseArgs } from 'node:util';
import { runCreate, type CreateOptions } from './commands/create.js';
import { runStart, type StartOptions } from './commands/start.js';
import { runStop, type StopOptions } from './commands/stop.js';
import { runStatus } from './commands/status.js';
import { runReset } from './commands/reset.js';
import { runDestroy } from './commands/destroy.js';
import { resolveHome } from './paths.js';
import { exitCode, renderJson, renderText, type Result } from './output.js';

export interface CliContext {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  onProgress: (message: string) => void;
  createOptions?: Partial<CreateOptions>;
  startOptions?: Partial<StartOptions>;
  stopOptions?: Partial<StopOptions>;
}

interface Flags {
  headless: boolean;
  bridge: boolean;
  save: boolean;
  yes: boolean;
}

/** A command's table entry: the flags it accepts, whether it works off macOS, and its work. */
interface Command {
  /** The non-global flags the command accepts (`--json` is global). */
  accepts: (keyof Flags)[];
  /** Works on any platform; commands without this need macOS. */
  platformFree?: true;
  /** Receives the validated instance name (if any) and the parsed flags. */
  run: (name: string | undefined, ctx: CliContext, flags: Flags) => Promise<Result>;
  /** The name is optional (default: required). */
  nameOptional?: true;
}

/** Declarative command table; key order is the order shown in the usage hint. */
const COMMANDS: Record<string, Command> = {
  start: {
    accepts: ['headless', 'bridge'],
    run: async (name, ctx, flags) =>
      runStart({
        home: homeFrom(ctx),
        name: name as string,
        headless: flags.headless,
        bridge: flags.bridge,
        onProgress: ctx.onProgress,
        ...ctx.startOptions,
      }),
  },
  stop: {
    accepts: ['save'],
    run: async (name, ctx, flags) =>
      runStop({ home: homeFrom(ctx), name: name as string, save: flags.save, ...ctx.stopOptions }),
  },
  create: {
    accepts: [],
    run: async (name, ctx) =>
      runCreate({
        home: homeFrom(ctx),
        name: name as string,
        onProgress: ctx.onProgress,
        ...ctx.createOptions,
      }),
  },
  status: {
    accepts: [],
    platformFree: true,
    nameOptional: true,
    run: async (name, ctx) =>
      runStatus({ home: homeFrom(ctx), ...(name !== undefined ? { name } : {}) }),
  },
  reset: {
    accepts: [],
    run: async (name, ctx) => runReset({ home: homeFrom(ctx), name: name as string }),
  },
  destroy: {
    accepts: ['yes'],
    run: async (name, ctx, flags) =>
      runDestroy({ home: homeFrom(ctx), name: name as string, yes: flags.yes }),
  },
};

const OPTIONS = {
  json: { type: 'boolean' },
  headless: { type: 'boolean' },
  bridge: { type: 'boolean' },
  save: { type: 'boolean' },
  yes: { type: 'boolean' },
} as const;

interface ParsedCli {
  command?: string;
  args: string[];
  json: boolean;
  flags: Flags;
}

/** Pure argv parsing: the command (first positional), its arguments and flags, or an error message. */
function parseCli(argv: string[]): ParsedCli | { error: string } {
  try {
    const { positionals, values } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: OPTIONS,
    });
    const [command, ...args] = positionals;
    return {
      ...(command !== undefined ? { command } : {}),
      args,
      json: values.json === true,
      flags: {
        headless: values.headless === true,
        bridge: values.bridge === true,
        save: values.save === true,
        yes: values.yes === true,
      },
    };
  } catch (error) {
    const option = error instanceof Error ? /'(-[^']*)'/.exec(error.message)?.[1] : undefined;
    return { error: option !== undefined ? `unknown option: ${option}` : 'invalid arguments' };
  }
}

export async function runCli(
  argv: string[],
  ctx: CliContext,
): Promise<{ stdout: string; exitCode: number }> {
  const parsed = parseCli(argv);
  const json = 'error' in parsed ? argv.includes('--json') : parsed.json;
  return finish(await execute(parsed, ctx), json);
}

/** Computes the Result for a parsed command line: a parse error, a usage error or a handler's outcome. */
async function execute(parsed: ParsedCli | { error: string }, ctx: CliContext): Promise<Result> {
  if ('error' in parsed) return usage(parsed.error);
  const { command, args, flags } = parsed;
  if (command === undefined) return usage('missing command');
  const entry = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  if (entry === undefined) return usage(`unknown command: ${command}`);
  if (ctx.platform !== 'darwin' && entry.platformFree !== true) {
    return {
      ok: false,
      error: {
        kind: 'unsupported_platform',
        message: `cuisctl needs macOS (this is ${ctx.platform})`,
      },
    };
  }
  const rejected = (Object.keys(flags) as (keyof Flags)[]).find(
    (flag) => flags[flag] && !entry.accepts.includes(flag),
  );
  if (rejected !== undefined) return usage(`unknown option: --${rejected}`);
  const [name, ...extras] = args;
  if (name === undefined && entry.nameOptional !== true) return usage('missing instance name');
  if (extras.length > 0) return usage('too many arguments');
  return entry.run(name, ctx, flags);
}

/** The cuisctl home directory: CUISCTL_HOME from the context env, else the default. */
function homeFrom(ctx: CliContext): string {
  return ctx.env.CUISCTL_HOME ?? resolveHome();
}

/** Renders a Result into the CLI's stdout text and process exit code. */
function finish(result: Result, json: boolean): { stdout: string; exitCode: number } {
  return { stdout: json ? renderJson(result) : renderText(result), exitCode: exitCode(result) };
}

function usageHint(): string {
  return `usage: cuisctl <${Object.keys(COMMANDS).join('|')}> [--json] [name]`;
}

/** A failed Result of kind 'usage' carrying the standard usage hint. */
function usage(message: string): Result {
  return { ok: false, error: { kind: 'usage', message, hint: usageHint() } };
}
