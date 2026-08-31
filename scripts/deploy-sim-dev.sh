#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_PATH="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/$(basename -- "${BASH_SOURCE[0]}")"
readonly SOURCE_ROOT="${SIM_SOURCE_ROOT:-$(git -C "$(dirname -- "$SCRIPT_PATH")/.." rev-parse --show-toplevel)}"
readonly DEPLOY_ROOT="${SIM_DEV_DEPLOY_ROOT:-${XDG_STATE_HOME:-$HOME/.local/state}/sim-dev-services}"
readonly BUILD_ROOT="${SIM_DEV_BUILD_ROOT:-$(dirname -- "$SOURCE_ROOT")/.sim-dev-builds-$(basename -- "$SOURCE_ROOT")}"
readonly SERVICE_ENV_FILE="${SIM_DEV_ENV_FILE:-$DEPLOY_ROOT/runtime.env}"
readonly DEPLOY_LOCK="$DEPLOY_ROOT/deploy.lock"
readonly DEPLOY_LOG="$DEPLOY_ROOT/deploy.log"
readonly MUTABLE_ROOT="$DEPLOY_ROOT/state"
readonly SHARED_UPLOADS_ROOT="$MUTABLE_ROOT/uploads"
readonly UPLOADS_INITIALIZED_MARKER="$MUTABLE_ROOT/uploads.initialized"
readonly DEPLOY_TIMEOUT_SECONDS="${SIM_DEV_DEPLOY_TIMEOUT_SECONDS:-180}"
readonly RELEASE_RETENTION="${SIM_DEV_RELEASE_RETENTION:-3}"
readonly PUBLIC_HOST="${SIM_PUBLIC_HOST:-127.0.0.1}"
readonly LATEST_PORT="${SIM_LATEST_PORT:-3300}"
readonly SNAPSHOT_PORT="${SIM_SNAPSHOT_PORT:-3301}"

SERVICE_NAME=
SERVICE_PORT=
SERVICE_ROOT=
SERVICE_RELEASES_ROOT=
SERVICE_CURRENT_LINK=
SERVICE_PREVIOUS_LINK=
SERVICE_PID_FILE=
SERVICE_LOG=
SERVICE_URL=
STAGING_ROOT=
BUILD_STAGING_ROOT=
ACTIVE_RELEASE=
DEPLOY_LOCK_FD=

fail() {
	printf 'deploy-sim-dev: %s\n' "$1" >&2
	exit 1
}

log() {
	printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$1"
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

print_usage() {
	cat <<'EOF'
Usage: deploy-sim-dev.sh <latest|snapshot> [options]

  latest                    Build and publish the current clean commit on port 3300.
  snapshot                  Restart the selected snapshot on port 3301.
  snapshot --update-snapshot
                            Build the current clean commit and select it as the snapshot.
  snapshot --from-latest    Pin a clone of the selected healthy latest release on port 3301.
  <service> --restart-selected
                            Restart the selected release without rebuilding (recovery only).
  <service> --recover-candidate
                            Publish the newest complete but unselected release (recovery only).
  <service> --status        Print the selected release and service status.
EOF
}

resolve_deploy_action() {
	local service="$1"
	local update_snapshot="$2"
	local restart_selected="$3"
	local from_latest="${4:-false}"

	if [[ "$from_latest" == true ]]; then
		[[ "$service" == snapshot ]] || fail '--from-latest is valid only for snapshot'
		[[ "$update_snapshot" == false && "$restart_selected" == false ]] || fail '--from-latest cannot be combined with another deployment action'
		printf 'clone-latest\n'
		return
	fi
	if [[ "$restart_selected" == true ]]; then
		printf 'restart\n'
		return
	fi
	case "$service" in
	latest)
		[[ "$update_snapshot" == false ]] || fail '--update-snapshot is valid only for snapshot'
		printf 'update\n'
		;;
	snapshot)
		if [[ "$update_snapshot" == true ]]; then
			printf 'update\n'
		else
			printf 'restart\n'
		fi
		;;
	*) fail "invalid service: $service (expected latest or snapshot)" ;;
	esac
}

configure_service() {
	local public_host="${SIM_PUBLIC_HOST:-$PUBLIC_HOST}"
	SERVICE_NAME="$1"
	case "$SERVICE_NAME" in
	latest) SERVICE_PORT="${SIM_LATEST_PORT:-$LATEST_PORT}" ;;
	snapshot) SERVICE_PORT="${SIM_SNAPSHOT_PORT:-$SNAPSHOT_PORT}" ;;
	*) fail "invalid service: $SERVICE_NAME (expected latest or snapshot)" ;;
	esac
	[[ "$SERVICE_PORT" =~ ^[1-9][0-9]*$ ]] || fail "invalid port for $SERVICE_NAME: $SERVICE_PORT"
	SERVICE_ROOT="$DEPLOY_ROOT/$SERVICE_NAME"
	SERVICE_RELEASES_ROOT="$SERVICE_ROOT/releases"
	SERVICE_CURRENT_LINK="$SERVICE_ROOT/current"
	SERVICE_PREVIOUS_LINK="$SERVICE_ROOT/previous"
	SERVICE_PID_FILE="$SERVICE_ROOT/service.pid"
	SERVICE_LOG="$SERVICE_ROOT/service.log"
	SERVICE_URL="http://$public_host:$SERVICE_PORT"
}

acquire_deployment_lock() {
	local lock_path="${1:-$DEPLOY_LOCK}"
	mkdir -p -- "$(dirname -- "$lock_path")"
	exec {DEPLOY_LOCK_FD}>"$lock_path"
	if ! flock --nonblock "$DEPLOY_LOCK_FD"; then
		printf 'deploy-sim-dev: another Sim deployment holds %s\n' "$lock_path" >&2
		return 75
	fi
}

close_deployment_lock_for_child() {
	[[ "${DEPLOY_LOCK_FD:-}" =~ ^[1-9][0-9]*$ ]] || return 0
	exec {DEPLOY_LOCK_FD}>&-
}

source_runtime_environment() {
	local mode
	if [[ -f "$SERVICE_ENV_FILE" ]]; then
		mode="$(stat -c '%a' "$SERVICE_ENV_FILE")"
		(( (8#$mode & 077) == 0 )) || fail "runtime env must not be group/world-readable: $SERVICE_ENV_FILE"
		set -a
		# shellcheck disable=SC1090
		source "$SERVICE_ENV_FILE"
		set +a
	fi
}

require_runtime_environment() {
	[[ -n "${DATABASE_URL:-}" ]] || fail "DATABASE_URL is required in the environment or $SERVICE_ENV_FILE"
	[[ -n "${BETTER_AUTH_SECRET:-}" ]] || fail "BETTER_AUTH_SECRET is required in the environment or $SERVICE_ENV_FILE"
	export NEXT_PUBLIC_APP_URL="$SERVICE_URL"
	export BETTER_AUTH_URL="$SERVICE_URL"
}

initialize_shared_uploads() {
	mkdir -p -- "$MUTABLE_ROOT" "$SHARED_UPLOADS_ROOT"
	chmod 0700 "$MUTABLE_ROOT" "$SHARED_UPLOADS_ROOT"
	if [[ ! -f "$UPLOADS_INITIALIZED_MARKER" ]]; then
		if [[ -d "$SOURCE_ROOT/apps/sim/uploads" ]]; then
			rsync --archive --ignore-existing --chmod=D0700,F0600 "$SOURCE_ROOT/apps/sim/uploads/" "$SHARED_UPLOADS_ROOT/"
		fi
		(umask 077 && touch "$UPLOADS_INITIALIZED_MARKER")
	fi
}

release_uploads_link_is_valid() {
	local release="$1"
	local uploads_root="${2:-$SHARED_UPLOADS_ROOT}"
	[[ -L "$release/apps/sim/uploads" && "$(readlink -f -- "$release/apps/sim/uploads")" == "$(readlink -f -- "$uploads_root")" ]]
}

link_release_uploads() {
	local release="$1"
	local uploads_root="${2:-$SHARED_UPLOADS_ROOT}"
	local uploads_link="$release/apps/sim/uploads"
	if [[ -L "$uploads_link" ]]; then
		release_uploads_link_is_valid "$release" "$uploads_root" || fail "release uploads link points to unexpected state: $release"
		return 0
	fi
	[[ ! -e "$uploads_link" ]] || fail "release contains mutable uploads data: $release"
	ln -s -- "$uploads_root" "$uploads_link"
}

merge_local_uploads() {
	local local_uploads="$1"
	local uploads_root="${2:-$SHARED_UPLOADS_ROOT}"
	[[ -d "$local_uploads" && ! -L "$local_uploads" ]] || return 0
	mkdir -p -- "$uploads_root"
	rsync --archive --chmod=D0700,F0600 "$local_uploads/" "$uploads_root/"
}

validate_release() {
	local release="$1"
	[[ -d "$release" && -x "$release/bin/node" && -f "$release/apps/sim/server.js" && -d "$release/apps/sim/.next/static" && -f "$release/manifest.env" ]]
}

prepare_release_with_shared_uploads() {
	local result_variable="$1"
	local release="$2"
	local clone_id
	local clone_root
	local clone_staging
	initialize_shared_uploads
	if release_uploads_link_is_valid "$release"; then
		printf -v "$result_variable" '%s' "$release"
		return 0
	fi
	if [[ -L "$release/apps/sim/uploads" ]]; then
		fail "release uploads link points to unexpected state: $release"
	fi
	merge_local_uploads "$release/apps/sim/uploads"
	clone_id="$(basename -- "$release")-state-$RANDOM"
	clone_root="$SERVICE_RELEASES_ROOT/$clone_id"
	STAGING_ROOT="$DEPLOY_ROOT/.staging-$SERVICE_NAME-$clone_id"
	clone_staging="$STAGING_ROOT/runtime"
	mkdir -p -- "$STAGING_ROOT" "$SERVICE_RELEASES_ROOT"
	cp -al -- "$release" "$clone_staging"
	if [[ -d "$clone_staging/apps/sim/uploads" && ! -L "$clone_staging/apps/sim/uploads" ]]; then
		rm -rf -- "$clone_staging/apps/sim/uploads"
	fi
	link_release_uploads "$clone_staging"
	validate_release "$clone_staging" || fail "state-linked candidate is incomplete: $clone_staging"
	mv -- "$clone_staging" "$clone_root"
	rmdir -- "$STAGING_ROOT"
	STAGING_ROOT=
	printf -v "$result_variable" '%s' "$clone_root"
}

resolve_release_link() {
	local link="$1"
	local release
	[[ -L "$link" ]] || return 1
	release="$(readlink -f -- "$link")"
	validate_release "$release" || return 1
	printf '%s\n' "$release"
}

set_release_link() {
	local link="$1"
	local release="$2"
	local temporary_link="${link}.tmp.$$"
	ln -s -- "$release" "$temporary_link"
	mv -Tf -- "$temporary_link" "$link"
}

service_pid() {
	[[ -f "$SERVICE_PID_FILE" ]] || return 1
	local pid
	pid="$(<"$SERVICE_PID_FILE")"
	[[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
	printf '%s\n' "$pid"
}

process_environment_value() {
	local pid="$1"
	local name="$2"
	[[ -r "/proc/$pid/environ" ]] || return 1
	tr '\0' '\n' <"/proc/$pid/environ" | sed -n "s/^${name}=//p" | head -n 1
}

is_release_working_directory() {
	local release="$1"
	local working_directory="$2"
	[[ "$working_directory" == "$release/apps/sim" ]]
}

is_recognized_service_process() {
	local pid="$1"
	local expected_release="${2:-}"
	local process_release
	local process_service
	local working_directory

	kill -0 "$pid" 2>/dev/null || return 1
	process_service="$(process_environment_value "$pid" SIM_DEV_SERVICE_NAME || true)"
	process_release="$(process_environment_value "$pid" SIM_DEV_RELEASE_ROOT || true)"
	working_directory="$(readlink -f -- "/proc/$pid/cwd" 2>/dev/null || true)"
	[[ "$process_service" == "$SERVICE_NAME" ]] || return 1
	[[ -n "$process_release" ]] || return 1
	is_release_working_directory "$process_release" "$working_directory" || return 1
	[[ -z "$expected_release" || "$process_release" == "$expected_release" ]] || return 1
	validate_release "$process_release"
}

listener_addresses() {
	ss -H -ltn "sport = :$SERVICE_PORT" 2>/dev/null | awk '{ print $4 }'
}

is_port_listening() {
	[[ -n "$(listener_addresses)" ]]
}

has_public_listener() {
	listener_addresses | grep -Eq "^(0\\.0\\.0\\.0|\\*|\\[::\\]):$SERVICE_PORT$"
}

running_release() {
	local pid
	pid="$(service_pid || true)"
	[[ -n "$pid" ]] || return 1
	is_recognized_service_process "$pid" || return 1
	process_environment_value "$pid" SIM_DEV_RELEASE_ROOT
}

prepare_active_release() {
	local pid
	local running
	pid="$(service_pid || true)"
	if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
		is_recognized_service_process "$pid" || fail "PID $pid is not owned by the $SERVICE_NAME deployment"
		running="$(running_release)"
		ACTIVE_RELEASE="$running"
		return
	fi
	[[ -z "$pid" ]] || rm -f -- "$SERVICE_PID_FILE"
	is_port_listening && fail "port $SERVICE_PORT is owned by an unrecognized process"
	ACTIVE_RELEASE="$(resolve_release_link "$SERVICE_CURRENT_LINK" || true)"
}

require_clean_source() {
	[[ "$(git -C "$SOURCE_ROOT" rev-parse --show-toplevel)" == "$SOURCE_ROOT" ]] || fail "invalid source root: $SOURCE_ROOT"
	[[ -d "$SOURCE_ROOT/node_modules" ]] || fail "source dependencies are missing: $SOURCE_ROOT/node_modules"
	[[ -z "$(git -C "$SOURCE_ROOT" status --porcelain=v1 --untracked-files=normal)" ]] || fail 'source has uncommitted files; validate and commit before deployment'
}

release_matches_source_commit() {
	local release="$1"
	local expected_commit="$2"
	local BUILT_AT= COMMIT= PORT= PUBLIC_URL= SERVICE= SOURCE=
	validate_release "$release" || return 1
	# shellcheck disable=SC1090
	source "$release/manifest.env"
	[[ "$SERVICE" == "$SERVICE_NAME" && "$PORT" == "$SERVICE_PORT" && "$COMMIT" == "$expected_commit" && "$SOURCE" == "$SOURCE_ROOT" && "$PUBLIC_URL" == "$SERVICE_URL" ]]
}

release_matches_service() {
	local release="$1"
	local BUILT_AT= COMMIT= PORT= PUBLIC_URL= SERVICE= SOURCE=
	validate_release "$release" || return 1
	# shellcheck disable=SC1090
	source "$release/manifest.env"
	[[ "$SERVICE" == "$SERVICE_NAME" && "$PORT" == "$SERVICE_PORT" && -n "$COMMIT" && "$SOURCE" == "$SOURCE_ROOT" && "$PUBLIC_URL" == "$SERVICE_URL" ]]
}

find_reusable_release() {
	local expected_commit="$1"
	local current
	local previous
	local release
	current="$(resolve_release_link "$SERVICE_CURRENT_LINK" || true)"
	previous="$(resolve_release_link "$SERVICE_PREVIOUS_LINK" || true)"
	while IFS= read -r release; do
		[[ "$release" != "$ACTIVE_RELEASE" && "$release" != "$current" && "$release" != "$previous" ]] || continue
		if release_matches_source_commit "$release" "$expected_commit"; then
			printf '%s\n' "$release"
			return 0
		fi
	done < <(find "$SERVICE_RELEASES_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
	return 1
}

find_recovery_release() {
	local current
	local previous
	local release
	current="$(resolve_release_link "$SERVICE_CURRENT_LINK" || true)"
	previous="$(resolve_release_link "$SERVICE_PREVIOUS_LINK" || true)"
	while IFS= read -r release; do
		[[ "$release" != "$ACTIVE_RELEASE" && "$release" != "$current" && "$release" != "$previous" ]] || continue
		if release_matches_service "$release"; then
			printf '%s\n' "$release"
			return 0
		fi
	done < <(find "$SERVICE_RELEASES_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
	return 1
}

build_candidate_source() {
	local source_stage="$1"
	(
		cd -- "$source_stage"
		export DOCKER_BUILD=true
		bun run --cwd apps/sim build
	)
}

snapshot_dependency_tree() {
	local source_modules="$1"
	local target_modules="$2"
	[[ -d "$source_modules" && ! -L "$source_modules" ]] || fail "dependency source is not a directory: $source_modules"
	[[ ! -e "$target_modules" && ! -L "$target_modules" ]] || fail "dependency target already exists: $target_modules"
	cp -al -- "$source_modules" "$target_modules"
	[[ -d "$target_modules" && ! -L "$target_modules" ]] || fail "dependency snapshot is invalid: $target_modules"
	patch_staged_onepassword_loader "$target_modules"
}

patch_staged_onepassword_loader() {
	local target_modules="$1"
	local loader="$target_modules/@1password/sdk-core/nodejs/core.js"
	local temporary_loader="$loader.tmp.$$"
	local original="const path = require('path').join(__dirname, 'core_bg.wasm');"
	local replacement="const path = __dirname + '/core_bg.wasm';"
	[[ -f "$loader" ]] || return 0
	if grep -Fqx "$replacement" "$loader"; then
		return 0
	fi
	grep -Fqx "$original" "$loader" || fail "unsupported @1password/sdk-core WASM loader"
	sed "s|^${original}$|${replacement}|" "$loader" >"$temporary_loader"
	chmod --reference="$loader" "$temporary_loader"
	mv -f -- "$temporary_loader" "$loader"
	grep -Fqx "$replacement" "$loader" || fail "failed to patch staged @1password/sdk-core WASM loader"
}

build_release() {
	local result_variable="$1"
	local commit
	local release_id
	local release_root
	local reusable_release
	local runtime_root
	local source_stage
	local standalone_root

	require_clean_source
	commit="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
	reusable_release="$(find_reusable_release "$commit" || true)"
	if [[ -n "$reusable_release" ]]; then
		log "Reusing complete, unselected Sim $SERVICE_NAME candidate for $commit."
		printf -v "$result_variable" '%s' "$reusable_release"
		return 0
	fi
	release_id="$(date -u +'%Y%m%dT%H%M%SZ')-${commit:0:12}-$RANDOM"
	STAGING_ROOT="$DEPLOY_ROOT/.staging-$SERVICE_NAME-$release_id"
	BUILD_STAGING_ROOT="$BUILD_ROOT/.staging-$SERVICE_NAME-$release_id"
	source_stage="$BUILD_STAGING_ROOT/source"
	runtime_root="$STAGING_ROOT/runtime"
	release_root="$SERVICE_RELEASES_ROOT/$release_id"
	mkdir -p -- "$source_stage" "$runtime_root/bin" "$SERVICE_RELEASES_ROOT" "$(dirname -- "$DEPLOY_LOG")"
	git -C "$SOURCE_ROOT" archive --format=tar HEAD | tar -xf - -C "$source_stage"
	snapshot_dependency_tree "$SOURCE_ROOT/node_modules" "$source_stage/node_modules"
	log "Building Sim $SERVICE_NAME candidate from $commit while the selected service stays online."
	build_candidate_source "$source_stage" 2>&1 | tee -a "$DEPLOY_LOG"
	standalone_root="$source_stage/apps/sim/.next/standalone"
	[[ -f "$standalone_root/apps/sim/server.js" ]] || fail "standalone build did not produce apps/sim/server.js"
	rsync --archive --copy-links "$standalone_root/" "$runtime_root/"
	mkdir -p -- "$runtime_root/apps/sim/.next"
	rsync --archive "$source_stage/apps/sim/.next/static/" "$runtime_root/apps/sim/.next/static/"
	if [[ -d "$source_stage/apps/sim/public" ]]; then
		rsync --archive "$source_stage/apps/sim/public/" "$runtime_root/apps/sim/public/"
	fi
	initialize_shared_uploads
	link_release_uploads "$runtime_root"
	cp -a -- "$(command -v node)" "$runtime_root/bin/node"
	chmod 0755 "$runtime_root/bin/node"
	{
		printf 'SERVICE=%q\n' "$SERVICE_NAME"
		printf 'PORT=%q\n' "$SERVICE_PORT"
		printf 'COMMIT=%q\n' "$commit"
		printf 'SOURCE=%q\n' "$SOURCE_ROOT"
		printf 'PUBLIC_URL=%q\n' "$SERVICE_URL"
		printf 'BUILT_AT=%q\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
	} >"$runtime_root/manifest.env"
	validate_release "$runtime_root" || fail "candidate runtime is incomplete: $runtime_root"
	mv -- "$runtime_root" "$release_root"
	rmdir -- "$STAGING_ROOT"
	STAGING_ROOT=
	printf -v "$result_variable" '%s' "$release_root"
}

stop_service() {
	local deadline
	local pid
	pid="$(service_pid || true)"
	if [[ -z "$pid" ]]; then
		is_port_listening && fail "port $SERVICE_PORT is owned by an unrecognized process"
		return 0
	fi
	if ! kill -0 "$pid" 2>/dev/null; then
		rm -f -- "$SERVICE_PID_FILE"
		is_port_listening && fail "port $SERVICE_PORT is owned by an unrecognized process"
		return
	fi
	is_recognized_service_process "$pid" || fail "refusing to stop unrecognized PID $pid"
	log "Stopping Sim $SERVICE_NAME service (PID $pid)."
	kill -TERM "$pid"
	deadline=$((SECONDS + 20))
	while kill -0 "$pid" 2>/dev/null; do
		if (( SECONDS >= deadline )); then
			kill -KILL "$pid"
			break
		fi
		sleep 0.2
	done
	rm -f -- "$SERVICE_PID_FILE"
	deadline=$((SECONDS + 10))
	while is_port_listening; do
		(( SECONDS < deadline )) || fail "port $SERVICE_PORT remained active after stopping the recognized service"
		sleep 0.2
	done
}

start_service() {
	local release="$1"
	local pid
	validate_release "$release" || return 1
	release_uploads_link_is_valid "$release" || return 1
	is_port_listening && return 1
	mkdir -p -- "$SERVICE_ROOT"
	{
		printf '\n'
		log "Starting Sim $SERVICE_NAME from $release on 0.0.0.0:$SERVICE_PORT."
	} >>"$SERVICE_LOG"
	(
		cd -- "$release/apps/sim"
		close_deployment_lock_for_child
		nohup setsid env \
			NODE_ENV=production \
			HOSTNAME=0.0.0.0 \
			PORT="$SERVICE_PORT" \
			NEXT_PUBLIC_APP_URL="$SERVICE_URL" \
			BETTER_AUTH_URL="$SERVICE_URL" \
			SIM_DEV_SERVICE_NAME="$SERVICE_NAME" \
			SIM_DEV_RELEASE_ROOT="$release" \
			"$release/bin/node" "$release/apps/sim/server.js" </dev/null >>"$SERVICE_LOG" 2>&1 &
		pid=$!
		printf '%s\n' "$pid" >"$SERVICE_PID_FILE.tmp"
		mv -f -- "$SERVICE_PID_FILE.tmp" "$SERVICE_PID_FILE"
	)
}

health_status() {
	curl --silent --show-error --location --output /dev/null --write-out '%{http_code}' --max-time 5 "http://127.0.0.1:$SERVICE_PORT/plan-graph-demo" 2>/dev/null || true
}

wait_until_ready() {
	local label="$1"
	local expected_release="$2"
	local deadline=$((SECONDS + DEPLOY_TIMEOUT_SECONDS))
	local pid

	while (( SECONDS < deadline )); do
		pid="$(service_pid || true)"
		if [[ -z "$pid" ]] || ! is_recognized_service_process "$pid" "$expected_release"; then
			printf 'Sim %s process exited before becoming healthy.\n' "$label" >&2
			return 1
		fi
		if [[ "$(health_status)" == 200 ]]; then
			has_public_listener || {
				printf 'Sim %s is healthy on loopback but not bound publicly on port %s.\n' "$label" "$SERVICE_PORT" >&2
				return 1
			}
			printf 'Sim %s is ready at %s/plan-graph-demo (0.0.0.0:%s).\n' "$label" "$SERVICE_URL" "$SERVICE_PORT"
			return 0
		fi
		sleep 2
	done
	printf 'Timed out after %s seconds waiting for Sim %s.\n' "$DEPLOY_TIMEOUT_SECONDS" "$label" >&2
	return 1
}

print_log_tail() {
	if [[ -f "$SERVICE_LOG" ]]; then
		printf '\nLast 80 lines from %s:\n' "$SERVICE_LOG" >&2
		tail -n 80 -- "$SERVICE_LOG" >&2
	fi
}

promote_release() {
	local candidate="$1"
	local previous="$2"
	if [[ -n "$previous" && "$previous" != "$candidate" ]]; then
		set_release_link "$SERVICE_PREVIOUS_LINK" "$previous"
	fi
	set_release_link "$SERVICE_CURRENT_LINK" "$candidate"
}

activate_release() {
	local candidate="$1"
	local previous="$2"
	validate_release "$candidate" || fail "cannot activate incomplete release: $candidate"
	stop_service
	if start_service "$candidate" && wait_until_ready "$SERVICE_NAME candidate" "$candidate"; then
		promote_release "$candidate" "$previous"
		return
	fi
	print_log_tail
	stop_service
	if [[ -n "$previous" && "$previous" != "$candidate" ]] && start_service "$previous" && wait_until_ready "$SERVICE_NAME rollback" "$previous"; then
		set_release_link "$SERVICE_CURRENT_LINK" "$previous"
		fail "candidate failed health checks; restored $previous"
	fi
	print_log_tail
	fail 'candidate failed and no healthy previous release could be restored'
}

prepare_snapshot_restart() {
	local result_variable="$1"
	local selected
	selected="$(resolve_release_link "$SERVICE_CURRENT_LINK" || true)"
	[[ -n "$selected" ]] || fail "no selected $SERVICE_NAME release; run snapshot --update-snapshot first"
	ACTIVE_RELEASE="$(resolve_release_link "$SERVICE_PREVIOUS_LINK" || true)"
	[[ "$ACTIVE_RELEASE" != "$selected" ]] || ACTIVE_RELEASE=
	printf -v "$result_variable" '%s' "$selected"
}

clone_selected_latest_release() {
	local result_variable="$1"
	local latest_release
	local clone_id
	local clone_root
	local clone_staging
	local BUILT_AT= COMMIT= PORT= PUBLIC_URL= SERVICE= SOURCE=
	latest_release="$(resolve_release_link "$DEPLOY_ROOT/latest/current" || true)"
	[[ -n "$latest_release" ]] || fail 'no selected latest release is available to snapshot'
	release_uploads_link_is_valid "$latest_release" || fail 'selected latest release does not use shared mutable uploads'
	# shellcheck disable=SC1090
	source "$latest_release/manifest.env"
	[[ "$SERVICE" == latest && -n "$COMMIT" && "$SOURCE" == "$SOURCE_ROOT" ]] || fail 'selected latest release manifest is incompatible'
	clone_id="$(date -u +'%Y%m%dT%H%M%SZ')-${COMMIT:0:12}-from-latest-$RANDOM"
	clone_root="$SERVICE_RELEASES_ROOT/$clone_id"
	STAGING_ROOT="$DEPLOY_ROOT/.staging-$SERVICE_NAME-$clone_id"
	clone_staging="$STAGING_ROOT/runtime"
	mkdir -p -- "$STAGING_ROOT" "$SERVICE_RELEASES_ROOT"
	cp -al -- "$latest_release" "$clone_staging"
	rm -f -- "$clone_staging/manifest.env"
	{
		printf 'SERVICE=%q\n' "$SERVICE_NAME"
		printf 'PORT=%q\n' "$SERVICE_PORT"
		printf 'COMMIT=%q\n' "$COMMIT"
		printf 'SOURCE=%q\n' "$SOURCE_ROOT"
		printf 'PUBLIC_URL=%q\n' "$SERVICE_URL"
		printf 'BUILT_AT=%q\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
		printf 'ORIGIN_RELEASE=%q\n' "$latest_release"
	} >"$clone_staging/manifest.env"
	validate_release "$clone_staging" || fail "latest-derived snapshot is incomplete: $clone_staging"
	mv -- "$clone_staging" "$clone_root"
	rmdir -- "$STAGING_ROOT"
	STAGING_ROOT=
	printf -v "$result_variable" '%s' "$clone_root"
}

cleanup_releases() {
	local current
	local index=0
	local live
	local previous
	local release
	local -a releases=()
	current="$(resolve_release_link "$SERVICE_CURRENT_LINK" || true)"
	previous="$(resolve_release_link "$SERVICE_PREVIOUS_LINK" || true)"
	live="$(running_release || true)"
	mapfile -t releases < <(find "$SERVICE_RELEASES_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
	for release in "${releases[@]}"; do
		index=$((index + 1))
		if (( index <= RELEASE_RETENTION )) || [[ "$release" == "$current" || "$release" == "$previous" || "$release" == "$live" ]]; then
			continue
		fi
		rm -rf -- "$release"
	done
}

run_deployment_action() {
	local action="$1"
	local candidate
	local selected
	case "$action" in
	clone-latest)
		prepare_active_release
		clone_selected_latest_release candidate
		activate_release "$candidate" "$ACTIVE_RELEASE"
		;;
	recover)
		prepare_active_release
		selected="$(resolve_release_link "$SERVICE_CURRENT_LINK" || true)"
		candidate="$(find_recovery_release || true)"
		if [[ -z "$candidate" && -n "$ACTIVE_RELEASE" && "$ACTIVE_RELEASE" != "$selected" ]] && release_matches_service "$ACTIVE_RELEASE"; then
			candidate="$ACTIVE_RELEASE"
		fi
		if [[ -z "$candidate" && -n "$selected" ]] && ! release_uploads_link_is_valid "$selected"; then
			candidate="$selected"
		fi
		[[ -n "$candidate" ]] || fail "no complete, unselected $SERVICE_NAME candidate is available"
		prepare_release_with_shared_uploads candidate "$candidate"
		log "Recovering Sim $SERVICE_NAME candidate $candidate."
		if [[ "$candidate" == "$ACTIVE_RELEASE" ]] && wait_until_ready "$SERVICE_NAME recovered candidate" "$candidate"; then
			promote_release "$candidate" "$selected"
		else
			activate_release "$candidate" "${selected:-$ACTIVE_RELEASE}"
		fi
		;;
	restart)
		prepare_snapshot_restart candidate
		activate_release "$candidate" "$ACTIVE_RELEASE"
		;;
	update)
		prepare_active_release
		build_release candidate
		activate_release "$candidate" "$ACTIVE_RELEASE"
		;;
	*) fail "unsupported deployment action: $action" ;;
	esac
	cleanup_releases
}

print_status() {
	local pid
	local selected
	local state=stopped
	selected="$(resolve_release_link "$SERVICE_CURRENT_LINK" || true)"
	pid="$(service_pid || true)"
	if [[ -n "$pid" ]] && is_recognized_service_process "$pid"; then
		state=running
	elif is_port_listening; then
		state=unknown-owner
	fi
	printf 'service=%s\nstate=%s\nurl=%s/plan-graph-demo\nselected=%s\n' "$SERVICE_NAME" "$state" "$SERVICE_URL" "${selected:-none}"
}

cleanup_staging() {
	case "$STAGING_ROOT" in
	"$DEPLOY_ROOT"/.staging-*) rm -rf -- "$STAGING_ROOT" ;;
	esac
	case "$BUILD_STAGING_ROOT" in
	"$BUILD_ROOT"/.staging-*) rm -rf -- "$BUILD_STAGING_ROOT" ;;
	esac
}

require_commands() {
	local command
	for command in awk basename bun chmod cp curl cut date dirname find flock git grep head kill ln mkdir mv node nohup readlink rsync sed setsid sort ss stat tail tar tee tr; do
		require_command "$command"
	done
}

main() {
	local action
	local from_latest=false
	local recover_candidate=false
	local restart_selected=false
	local service="${1:-}"
	local show_status=false
	local update_snapshot=false

	if [[ -z "$service" || "$service" == '--help' || "$service" == '-h' ]]; then
		print_usage
		return 0
	fi
	shift
	while (( $# > 0 )); do
		case "$1" in
		--from-latest) from_latest=true ;;
		--recover-candidate) recover_candidate=true ;;
		--update-snapshot) update_snapshot=true ;;
		--restart-selected) restart_selected=true ;;
		--status) show_status=true ;;
		--help | -h)
			print_usage
			return 0
			;;
		*) fail "unknown argument: $1" ;;
		esac
		shift
	done

	source_runtime_environment
	configure_service "$service"
	require_commands
	if [[ "$show_status" == true ]]; then
		print_status
		return
	fi
	[[ "$DEPLOY_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail 'SIM_DEV_DEPLOY_TIMEOUT_SECONDS must be a positive integer'
	[[ "$RELEASE_RETENTION" =~ ^[1-9][0-9]*$ ]] || fail 'SIM_DEV_RELEASE_RETENTION must be a positive integer'
	if [[ "$recover_candidate" == true ]]; then
		[[ "$update_snapshot" == false && "$restart_selected" == false && "$from_latest" == false ]] || fail '--recover-candidate cannot be combined with another deployment action'
		action=recover
	else
		action="$(resolve_deploy_action "$service" "$update_snapshot" "$restart_selected" "$from_latest")"
	fi
	acquire_deployment_lock || return $?
	trap cleanup_staging EXIT
	require_runtime_environment
	log "Sim deployment mode: $service ($action)."
	run_deployment_action "$action"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	main "$@"
fi
