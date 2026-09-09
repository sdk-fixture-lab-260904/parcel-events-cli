/**
 * Shell completion for the generated CLI. Static scripts complete command
 * words to depth 4, then the selected command's flags. No HTTP path blobs.
 */
import {
  completionFlags,
  completionPrefixes,
  topLevelWords,
  wordsAfter,
} from './completion-tree.js';
import type { CliSpec } from './model.js';

function quote(word: string): string {
  return word.replaceAll("'", "'\\''");
}

function prefixCase(prefix: readonly string[]): string {
  return prefix.join(' ');
}

function wordsForPrefix(spec: CliSpec, prefix: readonly string[]): readonly string[] {
  return prefix.length === 0 ? topLevelWords(spec) : wordsAfter(spec, prefix);
}

function tableCases(spec: CliSpec, assign: string): string {
  return completionPrefixes(spec)
    .map((prefix) => {
      const key = prefixCase(prefix);
      const words = wordsForPrefix(spec, prefix).join(' ');
      return `    '${quote(key)}') ${assign}="${words}" ;;`;
    })
    .join('\n');
}

/** Render the bash completion script (complete -W over the static words). */
export function bashCompletion(spec: CliSpec): string {
  const bin = spec.bin;
  const fn = bin.replaceAll('-', '_');
  return `# bash completion for ${bin} — generated, static (offline).
_${fn}() {
  local cur words path i
  cur="\${COMP_WORDS[COMP_CWORD]}"
  path=""
  for ((i=1; i<COMP_CWORD; i++)); do
    case "\${COMP_WORDS[i]}" in
      -*) ;;
      *) path="\${path:+$path }\${COMP_WORDS[i]}" ;;
    esac
  done
  case "$path" in
${tableCases(spec, 'words')}
    *) words="${completionFlags(spec).join(' ')}" ;;
  esac
  COMPREPLY=( $(compgen -W "$words" -- "$cur") )
  return 0
}
complete -F _${fn} ${bin}
`;
}

/** Render the zsh completion script (#compdef, _describe over static words). */
export function zshCompletion(spec: CliSpec): string {
  const bin = spec.bin;
  const fn = bin.replaceAll('-', '_');
  const flags = completionFlags(spec).map((flag) => `'${flag}'`).join(' ');
  return `#compdef ${bin}
# zsh completion for ${bin} — generated, static (offline).
_${fn}() {
  local path="" i choice
  local -a more flags
  flags=(${flags})
  for ((i=2; i<CURRENT; i++)); do
    case "$words[i]" in
      -*) ;;
      *) path="\${path:+$path }$words[i]" ;;
    esac
  done
  choice=""
  case "$path" in
${tableCases(spec, 'choice')}
    *) choice="${completionFlags(spec).join(' ')}" ;;
  esac
  more=(\${(s: :)choice})
  _describe 'next' more
  _describe 'flag' flags
}
_${fn} "$@"
`;
}

function fishFlagLines(spec: CliSpec): readonly string[] {
  return completionFlags(spec).map((flag) => `complete -c ${spec.bin} -l ${flag.slice(2)}`);
}

function fishSeen(prefix: readonly string[]): string {
  return prefix.map((word) => `__fish_seen_subcommand_from ${word}`).join('; and ');
}

function fishPathLines(spec: CliSpec): readonly string[] {
  const bin = spec.bin;
  const lines: string[] = [];
  for (const prefix of completionPrefixes(spec)) {
    if (prefix.length === 0) {
      for (const word of topLevelWords(spec)) {
        lines.push(`complete -c ${bin} -n __fish_use_subcommand -a ${word}`);
      }
      continue;
    }
    const next = wordsAfter(spec, prefix).filter((word) => !word.startsWith('-'));
    const seen = fishSeen(prefix);
    for (const word of next) lines.push(`complete -c ${bin} -n '${seen}' -a ${word}`);
    for (const flag of wordsAfter(spec, prefix).filter((word) => word.startsWith('--'))) {
      lines.push(`complete -c ${bin} -n '${seen}' -l ${flag.slice(2)}`);
    }
  }
  return lines;
}

/** Render the fish completion script (complete -c over the static words). */
export function fishCompletion(spec: CliSpec): string {
  const bin = spec.bin;
  const lines = [`# fish completion for ${bin} — generated, static (offline).`, `complete -c ${bin} -f`, ...fishPathLines(spec), ...fishFlagLines(spec)];
  return `${lines.join('\n')}\n`;
}
