#!/usr/bin/env bash
exec bash "$(dirname "$0")/../../services/engagement-pipeline/ops/runbooks/19-dispatch-scheduled-report.sh" "$@"
