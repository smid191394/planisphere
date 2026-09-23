# Security

## What Planisphere does with your code

It reads it, on your machine, and writes a `planisphere.json` beside it. The
analyzers parse source and never execute it, never send it anywhere, and never
download anything: what they need ships with the extension or is the toolchain
you already have.

The artifact holds the names, kinds and absolute paths of your symbols, and the
comment above a definition when the viewer asks for one. Committing it commits
those paths.

## Reporting a problem

Open a [security advisory](https://github.com/smid191394/planisphere/security/advisories/new),
or, if you would rather not use GitHub for it, raise an issue saying only that
you have something to report and how to reach you. Please do not put the detail
in a public issue.

Expect an answer within a week.
