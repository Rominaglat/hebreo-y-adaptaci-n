# Security policy

## Supported versions

The portal runs a single production deployment. Only the `main` branch is supported. There are no LTS branches.

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.** Email `security@example.com` with:

- Affected component (URL / file / endpoint).
- Steps to reproduce.
- Proof of exploit (screenshot, video, or curl one-liner) — text only, no live attacks.
- Your contact info for follow-up.

We acknowledge within **48 hours** and triage within **5 business days**. Critical issues (auth bypass, data exfiltration, RCE) are patched within **7 days**; others within 30 days.

We do not currently run a paid bug bounty program but appreciate responsible disclosure.

## Required branch protection (configure in GitHub Settings → Branches → main)

These are enforced manually until GitHub repository rules are committed via API:

- [x] Require a pull request before merging
- [x] Require approvals: **1** (CODEOWNERS-based)
- [x] Dismiss stale pull request approvals when new commits are pushed
- [x] Require review from Code Owners
- [x] Require status checks to pass before merging
  - [x] Require branches to be up to date before merging
  - Required checks:
    - `security / npm-audit`
    - `security / gitleaks`
- [x] Require conversation resolution before merging
- [x] Require signed commits
- [x] Require linear history
- [x] Do not allow bypassing the above settings
- [ ] Allow force pushes — **disable**
- [ ] Allow deletions — **disable**

## Required GitHub repository settings

- Disable "Allow auto-merge" unless you also require approvals AND status checks (we do).
- Disable "Allow merge commits" except for release branches; prefer squash.
- Settings → Code security → enable Dependabot security updates, secret scanning push protection, and code scanning (CodeQL).

## Required secrets

`GITHUB_TOKEN` is automatic. Optionally set:

- `CLAUDE_API_KEY` — only if you wire the [coderabbit][1] / [claude code-review][2] gate later.
- `SLACK_WEBHOOK_URL` — optional; for security alert dispatch.

[1]: https://www.coderabbit.ai/
[2]: https://github.com/anthropics/claude-code-security-review

## Severity reference

CRITICAL: exploitable without auth or with trivial auth (auth bypass, full DB exfil).
HIGH: privileged user can escalate or cross-tenant.
MEDIUM: defense-in-depth gap.
LOW: hygiene.
