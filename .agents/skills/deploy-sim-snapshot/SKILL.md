---
name: deploy-sim-snapshot
description: Pin, restart, or explicitly refresh Sim's reproducible snapshot trial service. Use when the user wants a stable comparison build, asks to preserve the current validated commit as a snapshot, or needs the pinned Sim demo restarted without moving it to newer source.
---

# Deploy Sim snapshot

Tell the user whether the pinned service will be restarted or explicitly refreshed. Normal use never
moves the snapshot:

```bash
bun run deploy:sim:snapshot
```

Create the first snapshot, or move it to the current clean and validated commit, only when the user
asks for a refresh:

```bash
bun run deploy:sim:snapshot:update
```

To pin the already-selected healthy latest runtime without compiling it again:

```bash
bun run deploy:sim:snapshot:from-latest
```

This remains an explicit snapshot move. It clones the immutable runtime into the snapshot release
set, rewrites only its service manifest for port 3301, and keeps later snapshot restarts pinned.

The command reads secrets from
`${SIM_DEV_ENV_FILE:-${XDG_STATE_HOME:-$HOME/.local/state}/sim-dev-services/runtime.env}` or the inherited environment.
Never print that file or its values. Configure `SIM_PUBLIC_HOST` there for an IP-based browser URL.
The service listens on `0.0.0.0`; port 3301 is the default.

The shared `scripts/deploy-sim-dev.sh` entry point keeps this release independent from the latest
service. It holds a global deployment lock, uses immutable standalone releases, verifies process
ownership and public health, rolls back after failed activation, and retains selected, previous, and
live releases during cleanup. Local uploads remain in the shared mutable deployment state and are
linked into each release before activation.

Never silently refresh a snapshot, never point it at the latest service's mutable selection, never
kill an unknown port owner, and never start an ad-hoc server on port 3301. On failure, report the
error and relevant service-log tail while leaving the previous healthy release selected.

When changing the deployment entry point, run `bun run test:deploy-sim` before live use.
