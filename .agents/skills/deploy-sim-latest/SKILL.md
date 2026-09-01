---
name: deploy-sim-latest
description: Build and atomically publish the current validated Sim commit to the always-latest trial service. Use once after source changes are committed and validated, when the user asks to update or restart the latest Sim demo, or when a remote browser needs the newest Plan Graph UI. Skip read-only and documentation-only work unless deployment is explicitly requested.
---

# Deploy Sim latest

Tell the user that the latest service update is starting. Run from the repository root:

```bash
bun run deploy:sim:latest
```

The command requires a clean checkout and reads secrets from
`${SIM_DEV_ENV_FILE:-${XDG_STATE_HOME:-$HOME/.local/state}/sim-dev-services/runtime.env}` or the inherited environment.
Never print that file or its values. Configure `SIM_PUBLIC_HOST` in it when remote browsers should
receive an IP-based origin. The service listens on `0.0.0.0`; port 3300 is the default.

The shared `scripts/deploy-sim-dev.sh` entry point holds one fail-fast lock across both Sim demo
services. It builds an immutable standalone candidate while the old release remains online,
validates process ownership before stopping anything, atomically promotes the candidate, checks the
Plan Graph URL and wildcard listener, and restores the prior release on failure. Local uploads live
under the shared deployment state root and are linked into each release before it becomes immutable.

For crash recovery only, restart the already-selected release without rebuilding:

```bash
bash scripts/deploy-sim-dev.sh latest --restart-selected
```

If a complete candidate was built but the deployment stopped before selecting it, recover that
unselected candidate explicitly without rebuilding:

```bash
bash scripts/deploy-sim-dev.sh latest --recover-candidate
```

Recovery must reuse an existing complete release; never rebuild automatically. If the command fails, report
the error and relevant service-log tail. Do not kill an unknown process merely because it owns port
3300, do not bypass the shared script with an ad-hoc `next dev`, and do not refresh the snapshot
service as part of a latest deployment.

When changing the deployment entry point, run `bun run test:deploy-sim` before a live update.
