#!/usr/bin/env bash
set -euo pipefail

# lego invokes this only when issuance or renewal is actually due.
systemctl stop nginx.service
