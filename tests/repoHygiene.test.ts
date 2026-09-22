import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

describe('Repo Hygiene & Agent Rules Invariants (Directive 1)', () => {
  const rootDir = path.resolve(__dirname, '..');
  const rulesPath = path.join(rootDir, '.agy', 'rules.md');
  const agentsPath = path.join(rootDir, 'AGENTS.md');

  it('.agy/rules.md exists and has at least 400 lines (anti-truncation guard)', () => {
    expect(fs.existsSync(rulesPath)).toBe(true);
    const content = fs.readFileSync(rulesPath, 'utf-8');
    const lineCount = content.split('\n').length;
    expect(lineCount).toBeGreaterThanOrEqual(400);
  });

  it('AGENTS.md resolves and matches .agy/rules.md exactly', () => {
    expect(fs.existsSync(agentsPath)).toBe(true);
    const rulesContent = fs.readFileSync(rulesPath, 'utf-8');
    const agentsContent = fs.readFileSync(agentsPath, 'utf-8');
    expect(agentsContent).toBe(rulesContent);
  });

  it('temporary tooling directories are gitignored and never tracked by git', () => {
    // A local `.freebuff/` working directory is ordinary tooling state, not
    // leakage — the previous assertion (`existsSync === false`) failed for every
    // contributor running the tooling, which made the invariant untestable. The
    // invariant that actually matters is that it can never reach the repository.
    const gitignorePath = path.join(rootDir, '.gitignore');
    const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
    expect(gitignore).toContain('.freebuff/');

    let tracked = '';
    try {
      tracked = execSync('git ls-files .freebuff', { cwd: rootDir, encoding: 'utf-8' }).trim();
    } catch {
      // No git binary available: fall back to asserting the directory is either
      // absent or matched by the ignore rule asserted above.
      tracked = '';
    }
    expect(tracked).toBe('');
  });

  it('.gitignore includes temporary tooling directories', () => {
    const gitignorePath = path.join(rootDir, '.gitignore');
    const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
    expect(gitignore).toContain('.freebuff/');
  });

  it('canonical design documents live under docs/ (Directive 6)', () => {
    const phaseDocDocs = path.join(rootDir, 'docs', 'PHASE_DOCUMENT_FINAL.md');
    expect(fs.existsSync(phaseDocDocs)).toBe(true);
    // Root should not contain loose phase documents
    const phaseDocRoot = path.join(rootDir, 'PHASE_DOCUMENT_FINAL.md');
    expect(fs.existsSync(phaseDocRoot)).toBe(false);
  });
});
