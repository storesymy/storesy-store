#!/usr/bin/env bash
#
# Hybrid bootstrap for one Storesy Cloudflare account.
#
# Creates (or reuses) the long-lived resources the deploy workflow expects,
# then prints the exact `gh variable set` commands for its GitHub Environment.
# It never prints credentials.
#
# Usage:
#   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
#     ./scripts/bootstrap-account.sh smbiz
#
# Optional overrides:
#   PAGES_PROJECT_NAME (default: the label, e.g. smbiz)
#   WORKER_NAME        (default: storesy-api)
#   D1_NAME            (default: storesy)
#   KV_NAME            (default: storesy-kv)
#   R2_BUCKET          (default: storesy-images)
#   D1_LOCATION        (default: apac)
#   WORKERS_SUBDOMAIN  (optional; skips the /workers/subdomain API call)
#
# Prerequisites: curl, jq, and a Cloudflare API token with Workers Scripts,
# D1, KV, R2, Pages and Account Settings access.

set -euo pipefail

ACCOUNT_LABEL="${ACCOUNT_LABEL:-${1:-}}"
if [[ -z "${ACCOUNT_LABEL}" ]]; then
  echo "usage: ACCOUNT_LABEL=smbiz CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... $0" >&2
  exit 1
fi
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required" >&2
  exit 1
fi
if [[ ! "${ACCOUNT_LABEL}" =~ ^[a-z0-9-]+$ ]]; then
  echo "ACCOUNT_LABEL must be lowercase letters, digits or hyphens (e.g. smbiz)" >&2
  exit 1
fi
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }

PAGES_PROJECT_NAME="${PAGES_PROJECT_NAME:-$ACCOUNT_LABEL}"
WORKER_NAME="${WORKER_NAME:-storesy-api}"
D1_NAME="${D1_NAME:-storesy}"
KV_NAME="${KV_NAME:-storesy-kv}"
R2_BUCKET="${R2_BUCKET:-storesy-images}"
D1_LOCATION="${D1_LOCATION:-apac}"
API_BASE="https://api.cloudflare.com/client/v4"

api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(
    -sS
    -X "$method"
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
    -H "Content-Type: application/json"
  )
  if [[ -n "${body}" ]]; then
    args+=(--data "${body}")
  fi
  curl "${args[@]}" "${API_BASE}${path}"
}

require_success() {
  local response="$1" context="$2"
  if ! jq -e '.success == true' >/dev/null 2>&1 <<<"${response}"; then
    echo "Cloudflare API failed: ${context}" >&2
    jq -r '.errors[]? | "  - \(.code): \(.message)"' <<<"${response}" >&2 || true
    echo "${response}" >&2
    exit 1
  fi
}

echo "Bootstrapping ${ACCOUNT_LABEL} (${CLOUDFLARE_ACCOUNT_ID})"

# The workers.dev subdomain is stable per account and forms the API hostname.
# Some account-owned tokens can deploy Workers but cannot read this endpoint,
# so an explicit WORKERS_SUBDOMAIN override is supported.
WORKERS_SUBDOMAIN="${WORKERS_SUBDOMAIN:-}"
if [[ -z "${WORKERS_SUBDOMAIN}" ]]; then
  SUBDOMAIN_RESPONSE="$(api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/subdomain")"
  require_success "${SUBDOMAIN_RESPONSE}" "read workers.dev subdomain"
  WORKERS_SUBDOMAIN="$(jq -r '.result.subdomain // empty' <<<"${SUBDOMAIN_RESPONSE}")"
fi

# Accept "nbrobot", "nbrobot.workers.dev" or a full https:// URL.
WORKERS_SUBDOMAIN="${WORKERS_SUBDOMAIN#https://}"
WORKERS_SUBDOMAIN="${WORKERS_SUBDOMAIN%.workers.dev}"

if [[ -z "${WORKERS_SUBDOMAIN}" ]]; then
  echo "This account has no workers.dev subdomain. Enable Workers & Pages first," >&2
  echo "or pass WORKERS_SUBDOMAIN=<subdomain>." >&2
  exit 1
fi

# D1 ------------------------------------------------------------------------
D1_LIST="$(api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database?per_page=100")"
require_success "${D1_LIST}" "list D1 databases"
D1_DATABASE_ID="$(jq -r --arg name "${D1_NAME}" '.result[]? | select(.name == $name) | .uuid' <<<"${D1_LIST}" | head -n 1)"
if [[ -z "${D1_DATABASE_ID}" ]]; then
  echo "Creating D1 database ${D1_NAME}…"
  D1_CREATED="$(api POST "/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database" "$(jq -nc --arg name "${D1_NAME}" --arg location "${D1_LOCATION}" '{name: $name, primary_location_hint: $location}')")"
  require_success "${D1_CREATED}" "create D1 database"
  D1_DATABASE_ID="$(jq -r '.result.uuid // empty' <<<"${D1_CREATED}")"
else
  echo "Reusing D1 database ${D1_NAME}"
fi
[[ -n "${D1_DATABASE_ID}" ]] || { echo "Could not resolve the D1 database id" >&2; exit 1; }

# KV ------------------------------------------------------------------------
KV_LIST="$(api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces?per_page=100")"
require_success "${KV_LIST}" "list KV namespaces"
KV_NAMESPACE_ID="$(jq -r --arg title "${KV_NAME}" '.result[]? | select(.title == $title) | .id' <<<"${KV_LIST}" | head -n 1)"
if [[ -z "${KV_NAMESPACE_ID}" ]]; then
  echo "Creating KV namespace ${KV_NAME}…"
  KV_CREATED="$(api POST "/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces" "$(jq -nc --arg title "${KV_NAME}" '{title: $title}')")"
  require_success "${KV_CREATED}" "create KV namespace"
  KV_NAMESPACE_ID="$(jq -r '.result.id // empty' <<<"${KV_CREATED}")"
else
  echo "Reusing KV namespace ${KV_NAME}"
fi
[[ -n "${KV_NAMESPACE_ID}" ]] || { echo "Could not resolve the KV namespace id" >&2; exit 1; }

# R2 ------------------------------------------------------------------------
R2_LIST="$(api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets?per_page=100")"
require_success "${R2_LIST}" "list R2 buckets"
R2_FOUND="$(jq -r --arg name "${R2_BUCKET}" '(.result.buckets // .result)[]? | select(.name == $name) | .name' <<<"${R2_LIST}" | head -n 1)"
if [[ -z "${R2_FOUND}" ]]; then
  echo "Creating R2 bucket ${R2_BUCKET}…"
  R2_CREATED="$(api POST "/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets" "$(jq -nc --arg name "${R2_BUCKET}" '{name: $name}')")"
  require_success "${R2_CREATED}" "create R2 bucket"
else
  echo "Reusing R2 bucket ${R2_BUCKET}"
fi

# Pages ---------------------------------------------------------------------
# The Pages list endpoint rejects large per_page values (8000024), so use
# its default page size.
PAGES_LIST="$(api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects")"
require_success "${PAGES_LIST}" "list Pages projects"
PAGES_EXISTS="$(jq -r --arg name "${PAGES_PROJECT_NAME}" '.result[]? | select(.name == $name) | .name' <<<"${PAGES_LIST}" | head -n 1)"
if [[ -z "${PAGES_EXISTS}" ]]; then
  echo "Creating Pages project ${PAGES_PROJECT_NAME}…"
  PAGES_CREATED="$(api POST "/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects" "$(jq -nc --arg name "${PAGES_PROJECT_NAME}" '{name: $name, production_branch: "main"}')")"
  require_success "${PAGES_CREATED}" "create Pages project"
  PAGES_SUBDOMAIN="$(jq -r '.result.subdomain // empty' <<<"${PAGES_CREATED}")"
else
  echo "Reusing Pages project ${PAGES_PROJECT_NAME}"
  PAGES_SUBDOMAIN="$(jq -r --arg name "${PAGES_PROJECT_NAME}" '.result[]? | select(.name == $name) | .subdomain // empty' <<<"${PAGES_LIST}" | head -n 1)"
fi

PAGES_SUBDOMAIN="${PAGES_SUBDOMAIN:-${PAGES_PROJECT_NAME}.pages.dev}"
WEB_ORIGIN="https://${PAGES_SUBDOMAIN}"
API_ORIGIN="https://${WORKER_NAME}.${WORKERS_SUBDOMAIN}.workers.dev"

cat <<EOF

Resources for ${ACCOUNT_LABEL}
==============================

CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID}
WORKER_NAME=${WORKER_NAME}
D1_DATABASE_ID=${D1_DATABASE_ID}
KV_NAMESPACE_ID=${KV_NAMESPACE_ID}
R2_BUCKET_NAME=${R2_BUCKET}
PAGES_PROJECT_NAME=${PAGES_PROJECT_NAME}
WORKERS_SUBDOMAIN=${WORKERS_SUBDOMAIN}   # just the part before .workers.dev

WEB_ORIGIN=${WEB_ORIGIN}
API_ORIGIN=${API_ORIGIN}

Add these in GitHub UI:

  Repository → Settings → Environments → ${ACCOUNT_LABEL} → Environment variables

    CLOUDFLARE_ACCOUNT_ID = ${CLOUDFLARE_ACCOUNT_ID}
    WORKER_NAME           = ${WORKER_NAME}
    D1_DATABASE_ID        = ${D1_DATABASE_ID}
    KV_NAMESPACE_ID       = ${KV_NAMESPACE_ID}
    R2_BUCKET_NAME        = ${R2_BUCKET}
    PAGES_PROJECT_NAME    = ${PAGES_PROJECT_NAME}
    WORKERS_SUBDOMAIN     = ${WORKERS_SUBDOMAIN}
    WEB_ORIGIN            = ${WEB_ORIGIN}

  Repository → Settings → Environments → ${ACCOUNT_LABEL} → Environment secrets

    CLOUDFLARE_API_TOKEN  = the token created in the Cloudflare dashboard
    INTEGRATIONS_KEY      = a fresh 32-byte base64 value

Generate the integration key with:

  openssl rand -base64 32

API_ORIGIN is derived by the deploy workflow from WORKER_NAME + WORKERS_SUBDOMAIN.
Set the optional API_ORIGIN variable only when using a custom API domain.

If the environment does not exist yet, create it first:

  Repository → Settings → Environments → New environment → ${ACCOUNT_LABEL}

The API token must be created in the Cloudflare dashboard; this script cannot
mint it. Give it Workers Scripts, D1, KV, R2, Pages and Account Settings access.
EOF
