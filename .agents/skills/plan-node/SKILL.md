---
name: plan-node
description: Claim and deliver one node from Sim's durable development Plan Graph. Use when an agent must atomically claim a ready DAG node, create or attach an isolated Git worktree and branch, follow the repository AGENTS.md files, open and bind a pull request, heartbeat or recover a writer lease, and let GitHub state unlock dependent nodes.
---

# Deliver a Plan Graph node

Treat the Plan Graph as the authority for ordering and ownership. Treat GitHub as the authority for Issue, PR, review, check, and merge facts.

## Configure access

Export a workspace API key without putting it in arguments or logs:

```bash
export SIM_API_URL='<sim-url>'
export SIM_API_KEY='<workspace-api-key>'
export SIM_WORKSPACE_ID='<workspace-id>'
```

The optional `SIM_PLAN_ID` defaults to `agent-session-prs`. Never commit these values.

## Inspect ready work

```bash
bun .agents/skills/plan-node/scripts/plan-node.ts inspect
```

Read the selected node's objective, dependencies, interfaces, expected paths, and existing artifact bindings. Stop if it is blocked or another non-expired writer lease owns it.

## Claim and provision

Atomically claim a node and create its worktree. The script uses the node's configured local
repository path, falling back to the current checkout when it is not set:

```bash
bun .agents/skills/plan-node/scripts/plan-node.ts claim --node PG-02 --agent codex-02
```

Use `--repo-root <path>` only to explicitly override the configured path for this attempt. A
successful claim records the resolved repository root and the provisioned worktree on the node.

To bind a worktree and branch that already exist:

```bash
bun .agents/skills/plan-node/scripts/plan-node.ts claim --node PG-01 --agent codex-01 \
  --existing-worktree "$PWD" --branch "$(git branch --show-current)"
```

The script uses the workspace file's content-version CAS token. A racing claim must fail with `409`; do not retry blindly. It assigns a monotonic fencing token, resolves the declared base SHA, and rolls the lease back if worktree provisioning fails.

Keep a long-running attempt alive with its immutable attempt ID:

```bash
bun .agents/skills/plan-node/scripts/plan-node.ts heartbeat --node PG-02 --attempt '<attempt-id>'
```

## Develop inside the claimed worktree

1. Change directory to the worktree printed by the claim.
2. Read every applicable `AGENTS.md` before editing.
3. Stay inside the node's objective, interfaces, expected paths, and authority scope.
4. Re-read upstream node PRs before changing a shared contract. Do not duplicate a store, schema, state machine, or abstraction another node owns.
5. Run focused tests while iterating and all repository-required checks before publishing.

Use the repository's `ship` workflow for cleanup, validation, commit, and PR hygiene. Use the Plan Graph's declared remote and default branch as the PR target when they differ from the upstream Sim defaults.

## Bind the pull request

After creating the PR, bind it with the same CAS path:

```bash
bun .agents/skills/plan-node/scripts/plan-node.ts bind-pr --node PG-02 --pr 42
```

Then select **Sync GitHub** in the Plan Graph. Never mark review, checks, or merge complete by hand; reconciliation owns those facts. A merged upstream node is what unlocks its dependents.

## Recover safely

- If a lease expires, claim again to create a new attempt and higher fencing token.
- Never let an older attempt write after a higher fencing token exists.
- Never move, reset, or delete another attempt's worktree or branch.
- If the plan CAS conflicts, inspect the newest revision and decide whether the node is still ready.
- Use the repository's `babysit` workflow only after a PR exists and only within this node's branch.
