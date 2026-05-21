# Agent Instructions

## Release Workflow

- Before creating or uploading any release artifact, update the root `package.json` `version`.
- The release zip filename and generated release `package.json` both use the root package version.
- Do not reuse an existing version for a new release unless the user explicitly asks to replace that exact release.
