# CLAUDE.md

Canonical machine-wide policy:
`~/.codex/AGENTS.md`

Repo-specific delta for this repository:

1. For local macOS Touch ID testing builds, use only:
   `scripts/dev/build-macos-touchid-agent.sh`
2. Do not use manual ad-hoc codesign commands.
3. If build/sign/deploy fails, stop and report the script output and latest KeeWeb crash logs.
