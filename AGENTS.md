# AGENTS.md

Machine-wide policy is defined in:
`~/.codex/AGENTS.md`

This file only adds repo-specific agent guidance.

## Repo-specific delta

1. For local macOS Touch ID testing, do not use manual codesign flows.
2. Use only:
   `scripts/dev/build-macos-touchid-agent.sh`
3. The script is the canonical agent entrypoint for:
   - arm64 build,
   - signed app generation,
   - provisioning profile wiring,
   - atomic deploy to `/Applications/KeeWeb-Codex.app`,
   - post-deploy signature verification.
4. If it fails, stop and report:
   - script output,
   - latest `~/Library/Logs/DiagnosticReports/KeeWeb*.ips`.
