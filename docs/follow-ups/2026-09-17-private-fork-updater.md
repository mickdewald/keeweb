# Private KeeWeb fork automatic updates

Requested on 2026-09-17 as a separate follow-up to the Caps Lock warning.

KeeWeb is an Electron app. `app/scripts/comp/launcher/launcher-electron.js`
explicitly disables the upstream updater because upstream updates would replace
this customized fork. Keep that guard until a private-fork update path is ready.

The shared `packages/app-updater` in the sibling turbo-swift repository provides
Sparkle-based automatic checks and native update dialogs for Swift apps. Use its
release and verification requirements as a reference; choose the appropriate
Electron integration in a separate PR rather than importing the Swift wrapper.

Acceptance for the follow-up:

- Use only fork-owned release metadata and artifacts; never upstream KeeWeb.
- Provide automatic checks and a manual Check for Updates action.
- Authenticate update artifacts and retain the app identity, signing, Touch ID
  entitlements and provisioning requirements.
- Protect unsaved database changes during installation and restart.
- Define release versioning, hosting, signing and publication together.
- Verify a real old-to-new signed app update and failed-update recovery before
  enabling the channel for existing installations.

Status: recorded, not implemented or published. Caps Lock delivery stays separate.
