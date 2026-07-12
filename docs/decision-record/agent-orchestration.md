We want one "cockpit" workspace.
One place for the user to manage all of the threads their agents are working on.

Agents are good at doing background work, but wherever human supervision is required, humans are best at focusing on one thing at a time.
 - User-managed worktrees and branching with an explicit commit history
    - which is more important than ever for gathering context
 - Avoid local configuration headaches (`.env` type stuff)
 - Avoid unnecessary IDE resource consumption from having to switch workspaces

We have a good opportunity to decouple the editing (supervision) experience from agent management
(Cursor inherited a good editor from VSCode but lacks in agent orchestration and also fucked the editor up)
or to integrate them closer where they're already separate
(Claude Code or CLI users I guess)

# Orchestration process

For now, we will orchestrate in VSCode's extension host.  Eventually we may move to a separate daemon

We will build the logic in some sort of separate impl package so that it will eventually be easy to remove