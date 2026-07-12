# Repo Structure

`packages/`:
- `apps/` - User front ends
    - `cli` - Agent orchestrator CLI
    - `vscode` - VSCode extension
- `backend/` - Shared implementation used by all front ends
- `public-libs/`
    - `caruso-cli` - [CLI Toolkit](#cli-toolkit)
- `core/` - Shared contracts
    - `contracts` - Domain-specific contracts, schemas, etc
    - `utils` - General low-level utils (avoid domain-specific details)


# Components
## Core lib

- This may result in a new Effect utils package
  - JSON

## CLI Toolkit

See [plan](./plans/cli-toolkit.md)
- [CLI toolkit](./plans/cli-toolkit.md) (with Effect) - in scope because the developer may want to manage git through the CLI 
  - Dry run?
  - Arg parsing and routing
  - Machine I/O
    - Socket 
    - STDIN / File
  - Human I/O
    - Prompting
    - Ink integration layer?

- **Effectful shell integration**
We will need it for interactions with Git and Cursor at a minimum.
But it would also be nice to feed this into the CLI toolkit too.
I find myself doing custom CLIs to wrap around other tools so often,
it'd be nice to have fully fledged logic (rather than Bash) while keeping the ergonomics of a shell script

## Domain lib

- Worktree toolkit
  - Registry of active worktrees
  - [Creation](./plans/worktree-creation.md) with dependency optimization or whatever

- Agent integration layer (cursor agent CLI invocations using the core lib shell integration)

## Application lib

- [Agent orcehstration](./decision-record/agent-orchestration.md)
  - Git features (worktrees + branch management)

## Applications

- Orchestrator CLI 
- VSCode plugin?
  - [Agent chats](./plans/agent-chats.md)
  - Error handling etc
  - Notifications when agent is done

# Configuration
 - [Worktree init]()
    - Setup step - `setupCommand`
    - CoW dependencies - `warmPaths`

# Tools
 - `tsup`