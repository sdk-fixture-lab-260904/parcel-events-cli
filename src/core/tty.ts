/**
 * Human-output gate (kernel 0.11.0). TTY table is opt-in via `io.isTty`.
 * CI / NO_COLOR / CLICOLOR=0 keep the agent JSON default.
 */
import type { CliIo } from './model.js';

/** True only when the host marked stdout a TTY and no CI/color-off env is set. */
export function wantHuman(io: CliIo): boolean {
  if (io.isTty !== true) return false;
  if (io.env['DOCTORINE_CI'] !== undefined) return false;
  if (io.env['NO_COLOR'] !== undefined) return false;
  if (io.env['CLICOLOR'] === '0') return false;
  return true;
}
