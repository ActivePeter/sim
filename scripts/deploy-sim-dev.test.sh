#!/usr/bin/env bash

set -euo pipefail

readonly TEST_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly DEPLOY_SCRIPT="$TEST_ROOT/deploy-sim-dev.sh"

fail_test() {
	printf 'deploy-sim-dev.test: %s\n' "$1" >&2
	exit 1
}

assert_equal() {
	local expected="$1"
	local actual="$2"
	[[ "$actual" == "$expected" ]] || fail_test "expected '$expected', got '$actual'"
}

bash -n "$DEPLOY_SCRIPT"
source "$DEPLOY_SCRIPT"
activation_definition="$(declare -f activate_release)"
eval "${activation_definition/activate_release/activate_real_release}"

assert_equal update "$(resolve_deploy_action latest false false)"
assert_equal restart "$(resolve_deploy_action latest false true)"
assert_equal restart "$(resolve_deploy_action snapshot false false)"
assert_equal update "$(resolve_deploy_action snapshot true false)"
if (resolve_deploy_action invalid false false) >/dev/null 2>&1; then
	fail_test 'invalid service was accepted'
fi

SIM_PUBLIC_HOST=192.0.2.10
SIM_LATEST_PORT=4400
configure_service latest
assert_equal 'http://192.0.2.10:4400' "$SERVICE_URL"
unset SIM_PUBLIC_HOST SIM_LATEST_PORT

configure_service snapshot
calls=()
prepare_snapshot_restart() {
	calls+=(prepare-snapshot)
	printf -v "$1" '%s' /test/snapshot
}
activate_release() { calls+=("activate:$1:${2:-}"); }
cleanup_releases() { calls+=(cleanup); }
for _ in {1..3}; do
	run_deployment_action restart
done
assert_equal 'prepare-snapshot activate:/test/snapshot: cleanup prepare-snapshot activate:/test/snapshot: cleanup prepare-snapshot activate:/test/snapshot: cleanup' "${calls[*]}"

calls=()
prepare_active_release() {
	calls+=(prepare-active)
	ACTIVE_RELEASE=/test/previous
}
build_release() {
	calls+=(build)
	printf -v "$1" '%s' /test/candidate
}
activate_release() { calls+=("activate:$1:$2"); }
cleanup_releases() { calls+=(cleanup); }
run_deployment_action update
assert_equal 'prepare-active build activate:/test/candidate:/test/previous cleanup' "${calls[*]}"

temporary_root="$(mktemp -d)"
holder_pid=
cleanup_test() {
	touch "$temporary_root/release" 2>/dev/null || true
	if [[ -n "$holder_pid" ]]; then
		wait "$holder_pid" 2>/dev/null || true
	fi
	rm -rf -- "$temporary_root"
}
trap cleanup_test EXIT

set +e
(
	set -e
	prepare_active_release() { :; }
	build_release() { return 42; }
	activate_release() { touch "$temporary_root/activated-after-build-failure"; }
	cleanup_releases() { touch "$temporary_root/cleaned-after-build-failure"; }
	run_deployment_action update
) >"$temporary_root/build-failure.log" 2>&1
build_failure_status=$?
set -e
assert_equal 42 "$build_failure_status"
[[ ! -e "$temporary_root/activated-after-build-failure" ]] || fail_test 'build failure reached activation'

set +e
(
	set -e
	validate_release() { :; }
	stop_service() { printf 'stop\n' >>"$temporary_root/rollback.calls"; }
	start_service() {
		printf 'start:%s\n' "$1" >>"$temporary_root/rollback.calls"
		return 0
	}
	wait_until_ready() {
		printf 'wait:%s:%s\n' "$1" "$2" >>"$temporary_root/rollback.calls"
		[[ "$1" == *rollback ]]
	}
	print_log_tail() { :; }
	set_release_link() { printf 'link:%s:%s\n' "$1" "$2" >>"$temporary_root/rollback.calls"; }
	activate_real_release /test/candidate /test/previous
) >"$temporary_root/rollback.log" 2>&1
rollback_status=$?
set -e
assert_equal 1 "$rollback_status"
grep -Fqx "link:$SERVICE_CURRENT_LINK:/test/previous" "$temporary_root/rollback.calls" || fail_test 'rollback did not restore the selected release'

(
	acquire_deployment_lock "$temporary_root/deploy.lock"
	touch "$temporary_root/lock-ready"
	while [[ ! -e "$temporary_root/release" ]]; do
		sleep 0.05
	done
) &
holder_pid=$!
for _ in {1..100}; do
	[[ -e "$temporary_root/lock-ready" ]] && break
	sleep 0.05
done
[[ -e "$temporary_root/lock-ready" ]] || fail_test 'timed out waiting for lock holder'
set +e
(
	acquire_deployment_lock "$temporary_root/deploy.lock"
) >"$temporary_root/contention.log" 2>&1
contention_status=$?
set -e
assert_equal 75 "$contention_status"
touch "$temporary_root/release"
wait "$holder_pid"
holder_pid=

set +e
(
	set -e
	service_pid() { printf '%s\n' "$$"; }
	kill() {
		if [[ "$1" == '-0' ]]; then
			return 0
		fi
		touch "$temporary_root/unrecognized-signalled"
		return 0
	}
	is_recognized_service_process() { return 1; }
	stop_service
) >"$temporary_root/ownership.log" 2>&1
ownership_status=$?
set -e
assert_equal 1 "$ownership_status"
[[ ! -e "$temporary_root/unrecognized-signalled" ]] || fail_test 'unrecognized process was signalled'

printf 'deploy-sim-dev tests passed\n'
