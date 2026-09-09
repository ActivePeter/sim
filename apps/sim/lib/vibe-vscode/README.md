# VS Code project agents in Sim

Project agents use native `copilot_chats`, `copilot_messages`, `copilot_runs`, Home, `useChat`,
stream envelopes, replay outbox, Stop and terminal finalization. There is no second
message store or forked chat component. A project agent's native chat ID is the same
in the VS Code editor, Sim's original sidebar chat list and
`/workspace/<workspaceId>/agents`.

## Data and lifecycle

`vscode_workspace_hosts` is a per-user, per-Sim-workspace projection of the host's
complete physical workspace, remote authority, projects and logical workspaces.
Revision compare-and-swap rejects stale catalog writes; equivalent projections
coalesce. The UI's project list is read from this database projection, never from
a hardcoded project catalog. The sidebar shows only its current host's projects;
the full Sim launcher can select projects across accessible hosts.

`vscode_project_sessions` binds a native chat to its immutable project origin and
server-owned runtime thread. Creation locks the canonical host, validates the
project/logical workspace and creates the native chat plus binding in one
transaction. A hashed user/workspace/request key makes retries return the same
chat. Browser input never selects a runtime thread or filesystem working directory.

The mounted iframe bridge owns sidebar/editor presentation identity. Route query
state is only its initial projection: native Next router transitions must not turn
an embedded surface into the standalone application shell. Workspace chrome reuses
the original `Sidebar` for navigation and renders only route content in VS Code
editors. The sidebar's project launcher stays in a compact popover, and successful
creation asks the host to open the native chat. Its transient project selection
does not navigate or reload an existing chat. Native chat-status subscription
belongs to the shared workspace chrome, not to its optional navigation sidebar,
so every embedded surface receives completion and cross-view transcript invalidations.

The bridge publishes committed navigation separately from passive restoration and
query updates. Internal resource new-tab/window actions use the host editor
capability; external documentation, OAuth windows and downloads remain browser
actions. The host owns resource-keyed tab identity: each workflow, DAG and native
chat opens independently, and opening it again reveals the existing tab. Its
editor serializer owns tab restoration, not a second Sim catalog. `VscodeEditorTitle`
projects names from the existing native queries through the bridge's `titleChanged`
message; previous-workspace query placeholders are not authoritative names.
Opening a monitored chat leaves the monitor route and filters intact; there is no
default full-screen application takeover.

The native per-chat stream lock claims a turn; its `copilot_runs` replay identity,
chat marker and user message commit in one transaction. A failed run registration
cannot start the runner or publish an orphan input. Native replay retains its
existing authenticated-user/run lookup; embedded sessions do not bypass that gate.
The local adapter translates Codex JSONL into Sim's versioned stream envelopes;
native transcript/finalization code saves the assistant and flushes buffered content
before recording a terminal run and emitting successful completion. Setup failures,
execution errors and explicit cancellation close the same native run. Stream IDs and
native user-message IDs are identical. Closing a tab
does not stop the runner. Explicit native Stop, ownership loss and the bounded
turn timeout terminate its process group. The finalizer's marker comparison
prevents an obsolete runner from overwriting a newer turn.

The global monitor queries each accessible workspace under current authorization,
shows its latest 500 native chats, and refreshes every four seconds. Terminal status
comes from the latest native run for each chat; the binding's old `lastOutcome` is
read-only compatibility for pre-run-record sessions. Network failure
is unknown state, not idle; permission loss hides the cached workspace. Stop carries
the observed stream ID. A process crash may interrupt a task: it is not silently
re-executed. Persisted messages survive and a new turn may be started after lock
reconciliation.

Agent streaming, replay and monitoring use native HTTP/SSE, Redis and database
queries; they do not depend on the workflow canvas's Socket.IO connection. Workflow
collaboration requires a separately paired realtime service sharing Sim's database
and authentication configuration.

## Local runner configuration

Supply these through the existing Sim runtime environment file
(`SIM_DEV_ENV_FILE` for the hosted deployment), outside the source/release trees.
Keep the file owner-readable only. Example values are placeholders:

```bash
VIBE_VSCODE_AGENT_GATEWAY_SECRET='<same-random-credential-as-the-main-Caddy-gateway>'
SIM_VSCODE_PROJECT_ROOTS='["<absolute-allowed-project-root>"]'
SIM_VSCODE_REMOTE_AUTHORITIES='["<browser-visible-vscode-host:port>"]'
SIM_VSCODE_CODEX_BINARY='<absolute-codex-executable>'
SIM_VSCODE_CODEX_HOME='<private-writable-codex-state-directory>'
SIM_VSCODE_CODEX_SANDBOX=read-only
```

The runner defaults to `read-only`. An operator can explicitly select
`workspace-write`; unrestricted execution is not supported. Use a dedicated writable
Codex home with configured credentials and thread storage; do not reuse a running
agent's mutable session database. Verify both an initial execution and `exec resume`
before enabling it. The runtime binary/model configuration belongs to the environment,
not to a browser request or project catalog.

Local `file:` project URIs are accepted only for a local physical workspace.
`vscode-remote:` URIs must match the captured remote authority and an explicit
environment mapping to this runner. Real paths must remain within an allowed root,
including symlink resolution. Unknown remote machines are never treated as local.
The child receives a bounded environment, not Sim's database or application secrets.
Redis-backed native stream ownership is required for sustained local turns.

## Authentication and input capabilities

Main's authenticated Caddy gateway strips a client-supplied Agent credential and
adds its private credential only after main authorizes the request. Sim validates
it in constant time, checks the browser origin for JSON mutations, then uses Sim's
real session principal and canonical workspace authorization. Direct access to an
auth-disabled development Sim port cannot execute project agents. No existing Sim
workspace is transferred to a different owner.

The immutable DB binding selects the local adapter at the native chat endpoint;
client-supplied runtime flags have no authority. Local project sessions use the
same composer with text-only capabilities. Project files can be referenced by path.
Cloud attachments/resources, voice and cloud-specific tool context are not exposed
for this runtime, and are rejected if supplied manually. Native service-side fork
and feedback actions are hidden for local sessions; copying a message remains
available. Other native chats retain their existing capabilities.

## Deployment and tests

Migration `0312_vscode_project_agents` adds only projection/binding tables, leaving
deployed native chat readers compatible. Apply the normal Drizzle migration, commit
validated source and use `bun run deploy:sim:latest` from a clean same-source checkout.
The deployment coordinator owns immutable releases, locking, health checks and rollback.

Tests cover operation authorization, catalog CAS, idempotent native chat creation,
remote/root policy, runtime arguments, native persistence and replay, browser
disconnect, cancellation, lost ownership, failed finalization and monitor authority.
Integration validation should use a dedicated test chat and a read-only prompt,
not production workflows or the planning DAG.
