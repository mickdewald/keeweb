# KeeWeb File-Size Epic Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every tracked handwritten JavaScript file in KeeWeb below the 500-line limit without changing runtime behavior, then ship and verify the completed branch.

**Architecture:** Continue the branch's existing prototype-mixin and focused-module patterns. Keep constructors, event maps, public exports, method names, call ordering, and side effects in their current owner classes; move only cohesive method groups or handler tables into adjacent modules and compose them back into the original export.

**Tech Stack:** JavaScript ES modules, KeeWeb's Model/View framework, Grunt, ESLint, Prettier, Mocha browser tests, Electron/macOS signed deployment.

**Spec:** The active branch `codex/file-size-epic`, the global 500-line handwritten-file limit, and the user's request to finish all remaining JavaScript splits.

## Global Constraints

-   Every tracked handwritten `.js`, `.jsx`, `.mjs`, and `.cjs` file must be at most 500 lines after the refactor.
-   Preserve all existing behavior and public module exports.
-   Follow existing `Object.assign(Class.prototype, Mixin)` composition where a class is split.
-   Do not add compatibility shims, suppressions, or unrelated cleanup.
-   Run the repo-owned test, lint, format, size, signed-build, and installed-app checks before release.

---

### Task 1: Characterize the remaining oversized surface

**Files:**

-   Inspect: `app/scripts/views/open-view.js`
-   Inspect: `app/scripts/comp/extension/protocol-impl.js`
-   Inspect: `app/scripts/views/settings/settings-file-view.js`
-   Inspect: `app/scripts/models/file-model.js`
-   Inspect: `app/scripts/plugins/plugin.js`
-   Inspect: `app/scripts/auto-type/auto-type-runner.js`

**Interfaces:**

-   Consumes: tracked JavaScript files and the 500-line repository rule.
-   Produces: an exact failing list of oversized files and cohesive extraction boundaries.

-   [ ] **Step 1: Run a repo-wide structural RED check**

    Enumerate tracked JavaScript files outside generated/dependency directories and fail while any file exceeds 500 lines. Expected RED result: exactly the six files listed above.

-   [ ] **Step 2: Run the existing tests before refactoring**

    Record the baseline suite result so later failures can be attributed to the extraction.

### Task 2: Split `OpenView`

**Files:**

-   Modify: `app/scripts/views/open-view.js`
-   Create: adjacent `open-view-*.js` mixin modules grouped around file input/opening, storage selection/configuration, and unlock/security helpers.

**Interfaces:**

-   Consumes: the current `OpenView` instance state, event map, and imported KeeWeb services.
-   Produces: the unchanged `OpenView` export composed with the extracted method objects.

-   [ ] **Step 1: Extract contiguous method groups without editing method bodies**
-   [ ] **Step 2: Compose the mixins after the class declaration**
-   [ ] **Step 3: Run formatter, lint, tests, and the structural size check**
-   [ ] **Step 4: Commit the independently reviewable split**

### Task 3: Split browser-extension protocol handling

**Files:**

-   Modify: `app/scripts/comp/extension/protocol-impl.js`
-   Create: focused adjacent protocol handler modules.

**Interfaces:**

-   Consumes: request crypto, client/session state, permission checks, entry selection, and response helpers.
-   Produces: the same `ProtocolImpl` export and action-to-handler mapping.

-   [ ] **Step 1: Move cohesive action handlers into factories that receive explicit shared helpers**
-   [ ] **Step 2: Merge the returned handler maps in the original module without changing action names**
-   [ ] **Step 3: Run formatter, lint, tests, and the structural size check**
-   [ ] **Step 4: Commit the independently reviewable split**

### Task 4: Split file settings and file model responsibilities

**Files:**

-   Modify: `app/scripts/views/settings/settings-file-view.js`
-   Create: adjacent settings-file mixins for save/storage, credentials, backups, and KDF/YubiKey settings.
-   Modify: `app/scripts/models/file-model.js`
-   Create: adjacent file-model mixins for lifecycle/traversal, credentials/settings, and serialization/sync operations.

**Interfaces:**

-   Consumes: the current view/model instance fields and unchanged KeeWeb service imports.
-   Produces: unchanged `SettingsFileView` and `FileModel` exports composed with focused mixins.

-   [ ] **Step 1: Extract settings-view method groups and compose them**
-   [ ] **Step 2: Verify formatting, lint, tests, and line counts**
-   [ ] **Step 3: Extract file-model method groups and compose them**
-   [ ] **Step 4: Verify formatting, lint, tests, and line counts**
-   [ ] **Step 5: Commit each independently reviewable split**

### Task 5: Split plugin and auto-type runner responsibilities

**Files:**

-   Modify: `app/scripts/plugins/plugin.js`
-   Create: adjacent plugin mixins for installation/resources and settings/update lifecycle.
-   Modify: `app/scripts/auto-type/auto-type-runner.js`
-   Create: an adjacent module for the existing auto-type operation handlers.

**Interfaces:**

-   Consumes: existing plugin model state and auto-type runner operation state.
-   Produces: unchanged `Plugin`, `PluginStatus`, and `AutoTypeRunner` exports.

-   [ ] **Step 1: Extract plugin method groups and compose them**
-   [ ] **Step 2: Verify formatting, lint, tests, and line counts**
-   [ ] **Step 3: Extract the auto-type operation table and import it from the runner**
-   [ ] **Step 4: Verify formatting, lint, tests, and line counts**
-   [ ] **Step 5: Commit each independently reviewable split**

### Task 6: Full verification and release

**Files:**

-   Verify: all branch changes against `origin/master`.
-   Deploy through: `scripts/dev/build-macos-touchid-agent.sh`

**Interfaces:**

-   Consumes: the completed branch with no tracked handwritten JavaScript file over 500 lines.
-   Produces: a signed installed app, green CI, merged fork PR, and a fully cleaned worktree/branch state.

-   [ ] **Step 1: Run the full test, ESLint, Prettier, and file-size checks fresh**
-   [ ] **Step 2: Run the canonical signed macOS build/deploy script and verify its signature result**
-   [ ] **Step 3: Exercise the installed app's file open/unlock, settings/save/backup, extension-facing startup, auto-type selection, plugin settings, Cmd+K click, and Cmd+K Enter paths**
-   [ ] **Step 4: Push the branch, open a PR against the user's fork, and wait for all required CI**
-   [ ] **Step 5: Merge after green CI and perform the mandatory post-merge absence/cleanup gate**
