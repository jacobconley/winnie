# Roadmap

- [ ] **Milestone 0: Repo foundation**
  - Set up monorepo packages:
    - `apps/vscode`
    - `helpers/orchestrator`
    - `core/contracts`
    - `core/utils`
    - `public-libs/caruso-cli`
  - Add TypeScript, Effect, and build conventions.
  - Define shared contracts: `ThreadId`, `RunId`, `AgentEvent`, `RunStatus`, `Task`.
  - Keep Caruso minimal for now; the orchestration MVP does not depend on a full CLI.

- [ ] **Milestone 1: Cursor transport spike**
  - Spawn `cursor-agent -p --output-format stream-json --stream-partial-output`.
  - Parse assistant deltas, tool events, final result, stderr, and nonzero exits.
  - Support `--resume`, `--workspace`, `--sandbox`, `--force`, and basic mode/model knobs.
  - Persist transcript/event logs to disk.
  - Implement stop by killing the child process.
  - **Exit criteria:** a test script can send a prompt, stream output, stop/resume, and replay the transcript.

- [ ] **Milestone 2: Orchestrator core**
  - Registry: tasks, threads, worktree paths, branches, and status.
  - Run manager: one active run per thread, process lifecycle, cancellation, and interrupted recovery.
  - Inject a directory-context message when a thread is transferred between workspaces.
  - Persist enough state to recover cleanly after extension reload.
  - **Exit criteria:** the backend can manage agent runs without any polished UI.

- [ ] **Milestone 3: Minimal VSCode sidebar**
  - Create a `WebviewView` in the secondary sidebar.
  - Render thread list / switcher.
  - Render transcript with live streaming updates.
  - Add prompt box and send action.
  - Add stop button.
  - Replay transcript when the webview remounts.
  - Add notifications on run finish/failure.
  - **Exit criteria:** agents work from VSCode: launch/resume a thread, watch live output, hide/show sidebar without losing state, and stop a run.

- [ ] **Milestone 4: Worktree MVP**
  - Create/register task worktrees.
  - Add configurable setup command.
  - Add initial copy-on-write dependency copy from the cockpit workspace.
  - Add basic git status/log helpers for inspection.
  - **Exit criteria:** create a worktree, launch an agent there, inspect via git, and keep the cockpit branch untouched.

- [ ] **Milestone 5: Product polish**
  - Full-editor prompt drafts.
  - Agent knobs UI: sandbox profile, mode, network, model.
  - Better error states and recovery prompts.
  - Config file for setup/warm paths.
  - Command palette entries and keybindings.

- [ ] **Deferred**
  - Orchestrator CLI.
  - Local daemon.
  - ACP transport.
  - Fancy terminal UI / Ink.
  - Worktree pool or dedicated template worktree.
  - Diff/review UI.
  - Marketplace/Open VSX publishing.