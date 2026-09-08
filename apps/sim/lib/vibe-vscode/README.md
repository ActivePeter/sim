# VS Code project agents in Sim

Project agents use native `copilot_chats`, `copilot_messages`, Home, `useChat`,
stream envelopes, replay outbox, Stop and terminal finalization. There is no second
message store or forked chat component. A project agent's native chat ID is the same
in the VS Code sidebar, Sim's chat list and `/workspace/<workspaceId>/agents`.

## Data and lifecycle

`vscode_workspace_hosts` is a per-user, per-Sim-workspace projection of the host's
complete physical workspace, remote authority, projects and logical workspaces.
Revision compare-and-swap rejects stale catalog writes; equivalent projections
coalesce. The UI's project list is read from this database projection, never from
a hardcoded project catalog.

`vscode_project_sessions` binds a native chat to its immutable project origin and
server-owned runtime thread. Creation locks the canonical host, validates the
project/logical workspace and creates the native chat plus binding in one
transaction. A hashed user/workspace/request key makes retries return the same
chat. Browser input never selects a runtime thread or filesystem working directory.

The native per-chat stream lock claims a turn before its user message is appended.
The local adapter translates Codex JSONL into Sim's versioned stream envelopes;
native transcript/finalization code saves the assistant before emitting successful
completion. Stream IDs and native user-message IDs are identical. Closing a tab
does not stop the runner. Explicit native Stop, ownership loss and the bounded
turn timeout terminate its process group. The finalizer's marker comparison
prevents an obsolete runner from overwriting a newer turn.

The global monitor queries each accessible workspace under current authorization,
shows its latest 500 native chats, and refreshes every four seconds. Network failure
is unknown state, not idle; permission loss hides the cached workspace. Stop carries
the observed stream ID. A process crash may interrupt a task: it is not silently
re-executed. Persisted messages survive and a new turn may be started after lock
reconciliation.

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
for this runtime, and are rejected if supplied manually.

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
