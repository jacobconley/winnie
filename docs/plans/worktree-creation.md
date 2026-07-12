We need a configurable setup script

## Copy-on-write dependency templates

Dependencies are often slow to install in worktrees
Copy-on-write supported by MacOS and Linux
**Tradeoffs / footguns**:
    - `git clean -fdx` deletes `node_modules` and CoW sharing — recycle with `git restore` + `git clean -fd` (no `-x`), then re-clone/reinstall.
    - CoW only works within one APFS volume; template and worktrees must co-locate.

At first, we can CoW from the cockpit workspace; later we may want to auto instantiate a separate 'template' worktree to copy from.

# Architecture