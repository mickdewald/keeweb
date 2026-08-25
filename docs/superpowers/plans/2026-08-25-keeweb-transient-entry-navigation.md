# KeeWeb Transient Entry Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Cmd+K entry selection leave transient views and visibly open the selected entry through one consistent navigation path.

**Architecture:** Add `AppView.navigateToEntry(entry)` to the existing transient-navigation mixin. It returns to the entries workspace, restores the saved workspace state, makes the destination visible through the existing menu/filter model, and only then emits the canonical `select-entry` event. Cmd+K and Password Health delegate to this method; AutoType remains separate.

**Tech Stack:** KeeWeb JavaScript, Backbone-style views/events, Mocha/Chai browser tests, Grunt, Electron/macOS.

**Spec:** `docs/superpowers/plans/2026-08-25-keeweb-transient-entry-navigation.md#behavioral-specification`

## Global Constraints

- Preserve the current command-palette contract: plain Enter and row click open the entry; no-match Enter keeps the palette open; Escape cancels.
- Preserve every AutoType Enter and modifier-Enter behavior unchanged.
- Use the existing `Events.emit('select-entry', entry)` model boundary; do not select a rendered list row directly.
- Keep menu selection and filter state consistent when the destination is outside the restored workspace filter.
- Do not grow existing hotspot files `app/scripts/views/app-view.js`, `app/scripts/views/list-view.js`, or `test/src/views/app-view-transient-navigation.js`.
- Do not add dependencies, compatibility shims, or unrelated refactors.
- Build, sign, and deploy macOS only through `scripts/dev/build-macos-touchid-agent.sh`.
- Do not commit, push, merge, or delete the worktree without explicit user authorization.

## Behavioral Specification

1. Selecting a Cmd+K result from the normal list, Settings, Password Health, Trash, or another transient full-screen view must end in the entries workspace with that entry active and visible.
2. The saved workspace filter, sort, active entry, and menu selection are restored before checking whether the new destination is visible.
3. If the restored filter hides the destination, select the existing `model.menu.allItemsItem` first so the visible menu state matches the filter.
4. Because selecting All Items intentionally preserves an attachment filter, explicitly call `model.setFilter({ attachments: false })` only if the destination is still hidden after selecting All Items.
5. The final selection goes through `Events.emit('select-entry', entry)` so model refresh, list rendering, and details rendering use their normal listeners.
6. Password Health and Cmd+K must share this navigation path. Workspace-internal issue selection is outside this change.

## File Map

- Create `test/src/views/app-view-entry-navigation.js`: focused tests for navigation order, filter/menu reconciliation, and source-view delegation.
- Modify `test/src/views/app-view-command-palette.js`: verify a Cmd+K `select: true` result delegates to `navigateToEntry`; remove the direct-list expectation.
- Modify `test/src/views/select-entry-view.js`: cover row-click parity, passwordless entries, no-match Enter, Escape, and AutoType preservation.
- Modify `app/scripts/views/app-view-transient-navigation.js`: add `navigateToEntry(entry)` and route Password Health selection through it.
- Modify `app/scripts/views/app-view.js`: route command-palette selection through `navigateToEntry` and remove `selectCmdPaletteEntry`.
- Keep the current locale and `SelectEntryView.enterPressed()` changes; adjust only if the new tests expose a concrete gap.

---

### Task 1: Lock the command-palette interaction contract

**Files:**
- Modify: `test/src/views/select-entry-view.js`
- Verify existing implementation: `app/scripts/views/select/select-entry-view.js`

**Interfaces:**
- Consumes: `SelectEntryView.enterPressed()`, `itemClicked()`, `escPressed()`, and `closeWithSelection()`.
- Produces: the invariant that both keyboard and mouse emit `{ entry, select: true }` in command-palette mode while AutoType continues to emit its existing result shape.

- [ ] **Step 1: Add failing interaction tests**

Add focused prototype-level tests using the existing event emitter pattern. Cover these exact expectations:

```js
expect(commandPaletteResultFromEnter(entry)).to.deep.equal({ entry, select: true });
expect(commandPaletteResultFromClick(entry)).to.deep.equal({ entry, select: true });
expect(commandPaletteResultFromEnter(passwordlessEntry)).to.deep.equal({
    entry: passwordlessEntry,
    select: true
});
expect(noMatchEnterResults).to.deep.equal([]);
expect(cancelResults).to.deep.equal([null]);
expect(autoTypeEnterResult).to.deep.equal({ entry, sequence: undefined });
expect(autoTypeActionEnterResult).to.deep.equal({ entry, sequence: '{PASSWORD}' });
expect(autoTypeOptionEnterResult).to.deep.equal({ entry, sequence: '{USERNAME}' });
expect(autoTypeShiftEnterResults).to.deep.equal([]);
```

For `itemClicked`, provide a minimal jQuery row with `data-id="target-entry"` and an entries collection whose `get('target-entry')` returns the fixture. For no-match Enter, stub `showPaletteHint` and assert it receives `Locale.cmdPaletteNoMatch` without emitting a result. Exercise `actionEnterPressed()` and `optEnterPressed()` directly. For `shiftEnterPressed(event)`, provide an active row plus a `showItemOptions` recorder and assert the options path is called without a result emission.

- [ ] **Step 2: Run the test suite and confirm the new tests expose only missing coverage**

Run `npm test`. Expected before production changes: the existing Enter behavior passes; any mouse/no-match/AutoType test must either pass as characterization or fail for a specific mismatch. Do not change production behavior merely to force a characterization assertion.

- [ ] **Step 3: Make only evidence-required adjustments**

If a test reveals a real mismatch in the already-requested command-palette contract, make the smallest change in `select-entry-view.js`. Do not change `setupKeys()` or AutoType modifier handlers unless an existing behavior was accidentally altered by the current branch.

- [ ] **Step 4: Re-run `npm test`**

Expected: all interaction-contract tests pass.

---

### Task 2: Specify centralized transient-view navigation

**Files:**
- Create: `test/src/views/app-view-entry-navigation.js`
- Modify: `test/src/views/app-view-command-palette.js`
- Test reference only: `test/src/views/app-view-transient-navigation.js`

**Interfaces:**
- Consumes: `AppView.showEntries()`, `restoreWorkspaceView()`, `model.getEntries()`, `model.menu.select({ item })`, `model.setFilter(filter)`, and global `Events`.
- Produces: `AppView.navigateToEntry(entry): void` with the ordered navigation contract below.

- [ ] **Step 1: Write a failing visible-destination test**

Create a fixture that records calls and uses a named `select-entry` listener to record the final selection. Register and remove it with `Events.on`/`Events.off` inside `try`/`finally`, so the expected red-phase exception cannot leak a listener into later tests:

```js
const onSelectEntry = (selected) => {
    calls.push('select-entry');
    selectedEntry = selected;
};
Events.on('select-entry', onSelectEntry);
try {
    AppView.prototype.navigateToEntry.call(view, entry);
} finally {
    Events.off('select-entry', onSelectEntry);
}

expect(calls).to.deep.equal(['showEntries', 'restoreWorkspaceView', 'select-entry']);
expect(menuSelections).to.deep.equal([]);
expect(resetFilters).to.deep.equal([]);
expect(selectedEntry).to.equal(entry);
```

Use plain counters and arrays consistent with the repo's existing Chai setup; do not use Sinon or Chai spy matchers. Apply the same named-listener plus `finally` cleanup pattern to every test observing `select-entry`.

- [ ] **Step 2: Write a failing hidden-destination/menu-consistency test**

Model `getEntries()` so the restored workspace hides the entry and selecting `allItemsItem` reveals it. Assert this order:

```js
expect(calls).to.deep.equal([
    'showEntries',
    'restoreWorkspaceView',
    'getEntries:hidden',
    'menu:all-items',
    'getEntries:visible',
    'select-entry'
]);
expect(resetFilters).to.deep.equal([]);
```

Also assert the restored sort/filter/menu state is observable before the first visibility check.

- [ ] **Step 3: Write a failing attachment-filter fallback test**

Keep the entry hidden after All Items is selected, reveal it only after `setFilter({ attachments: false })`, and assert:

```js
expect(menuSelections).to.deep.equal([{ item: model.menu.allItemsItem }]);
expect(resetFilters).to.deep.equal([{ attachments: false }]);
expect(selectedEntry).to.equal(entry);
```

- [ ] **Step 4: Cover transient origins and wiring**

Add cases for:

- a saved Settings-like `workspaceReturnState`;
- Trash with a saved filter that hides the palette destination;
- no `workspaceReturnState`;
- Password Health's `select` event delegating exactly once to `navigateToEntry(entry)`;
- a command-palette `{ entry, select: true }` result delegating exactly once to `navigateToEntry(entry)`.

For the command-palette wiring test, stub only rendering/removal boundaries needed to call `showCmdPalette()`, emit the result on `view.views.cmdPalette`, and restore all patched prototypes in `finally`.

- [ ] **Step 5: Run `npm test` and confirm the new navigation tests fail for the missing method/direct-list path**

Expected: failures point to absent `navigateToEntry` and existing direct list selection. Existing tests remain green.

---

### Task 3: Implement the single transient-navigation path

**Files:**
- Modify: `app/scripts/views/app-view-transient-navigation.js`
- Modify: `app/scripts/views/app-view.js`

**Interfaces:**
- Consumes: the Task 2 contract.
- Produces: `navigateToEntry(entry)` used by Cmd+K and Password Health.

- [ ] **Step 1: Add the minimal implementation to the transient-navigation mixin**

Implement the reviewed sequence:

```js
navigateToEntry(entry) {
    this.showEntries();
    this.restoreWorkspaceView();
    if (!this.model.getEntries().get(entry.id)) {
        this.model.menu.select({ item: this.model.menu.allItemsItem });
        if (!this.model.getEntries().get(entry.id)) {
            // All Items intentionally preserves the attachment filter.
            this.model.setFilter({ attachments: false });
        }
    }
    Events.emit('select-entry', entry);
},
```

Do not generalize this into a new global event or alter workspace-internal issue navigation.

- [ ] **Step 2: Route Password Health through the new method**

Replace its inline `showEntries()`, `restoreWorkspaceView()`, and `Events.emit(...)` sequence with:

```js
view.on('select', (entry) => this.navigateToEntry(entry));
```

- [ ] **Step 3: Route Cmd+K through the same method and remove direct DOM selection**

In the command-palette result handler, replace `this.selectCmdPaletteEntry(entry)` with `this.navigateToEntry(entry)`. Delete `selectCmdPaletteEntry()` completely. Do not add a compatibility wrapper.

- [ ] **Step 4: Run the focused and full tests**

Run `npm test`. Expected: all navigation and existing tests pass.

- [ ] **Step 5: Run lint and the repository file-size guard**

Run `npm run lint` and `CHECK_EXTENSIONS=.js,.jsx,.mjs,.cjs python3 ./scripts/check-file-sizes.py`. Expected: both pass; `app-view.js` shrinks and no existing hotspot grows.

---

### Task 4: Build, deploy, and prove installed behavior

**Files:**
- No source changes expected.
- Canonical build/deploy entrypoint: `scripts/dev/build-macos-touchid-agent.sh`

**Interfaces:**
- Consumes: green Task 3 tests/lint/size guard.
- Produces: signed `/Applications/KeeWeb.app` with installed-app behavior evidence.

- [ ] **Step 1: Recheck repository boundaries before deployment**

Confirm the feature worktree contains only the intended existing and new changes, while `$HOME/projects/keeweb` remains clean on `master`.

- [ ] **Step 2: Quit the currently running KeeWeb process**

Close KeeWeb cleanly before deployment so the subsequent smoke test cannot exercise the old process image.

- [ ] **Step 3: Build and deploy exclusively through the canonical script**

Run `./scripts/dev/build-macos-touchid-agent.sh`. Expected: signed arm64 build, atomic installation to `/Applications/KeeWeb.app`, and successful post-deploy signature verification.

- [ ] **Step 4: Run non-mutating installed-app smoke tests**

With the real local database already available, verify without copying, editing, deleting, or auto-typing credentials:

1. Normal list → Cmd+K → search → Down → Enter opens the target.
2. Settings → Cmd+K → search → Down → Enter leaves Settings and opens the target.
3. Password Health → Cmd+K → search → Down → Enter leaves Health and opens the target.
4. Trash → Cmd+K → search → Down → Enter leaves Trash and opens an active target.
5. At least one Cmd+K row click follows the same destination behavior.
6. No-match Enter keeps the palette open.
7. Escape closes the palette without changing the active entry.
8. When a hidden target forces All Items, the visible menu highlight and list contents agree.

- [ ] **Step 5: Final verification and handoff**

Confirm the installed process is `/Applications/KeeWeb.app`, signature verification remains valid, the canonical checkout is still clean on `master`, and the feature worktree remains uncommitted unless the user separately authorizes a commit or PR.
