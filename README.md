# Winnie

**Winnie** is a headless agent orchestrator.
It lets you run background agents on Git worktrees, but you can switch them to and from your foreground as you wish, while keeping the same agent chat thread context.
When the job is done, it provides rebase and conflict resolution tools to seamlessly pull the changes into your working branch.

You keep the parallel productivity boost of background agents, without sacrificing your ability to supervise and review, and keeping a clean commit history for the outside world.

v1 will ship with a Cursor back end (via `cursor-agent`) and CLI + VSCode front ends (mimicking the ergonomics of Cursor IDE's chat pane plus the orchestration functionality of Winnie).

## Development

Winnie targets Node 24 and uses pnpm through Corepack.

```sh
asdf install
corepack enable pnpm
asdf reshim nodejs
pnpm install
```

Use `pnpm run build`, `pnpm run typecheck`, and `pnpm run lint` from the repo root.

## Docs

- [Roadmap](docs/roadmap.md)
- [Components](docs/components.md)
- [Agent orchestration](docs/decision-record/agent-orchestration.md)
- [Agent chat architecture](docs/decision-record/agent-chat-architecture.md)
