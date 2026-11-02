#!/usr/bin/env bash
set -euo pipefail

readonly source_dir="${1:?usage: install-config.sh SOURCE_DIR}"

install -d -o root -g root -m 0700 /etc/plebeian-auctions-poc/acme
install -d -o root -g root -m 0755 /usr/local/libexec
install -o root -g root -m 0755 \
  "$source_dir/acme-pre.sh" /usr/local/libexec/plebeian-poc-acme-pre
install -o root -g root -m 0755 \
  "$source_dir/acme-post.sh" /usr/local/libexec/plebeian-poc-acme-post
install -o root -g root -m 0644 \
  "$source_dir/nginx-plebeian-poc.conf" \
  /etc/nginx/sites-available/plebeian-poc
install -o root -g root -m 0644 \
  "$source_dir/plebeian-poc-acme.service" \
  /etc/systemd/system/plebeian-poc-acme.service
install -o root -g root -m 0644 \
  "$source_dir/plebeian-poc-acme.timer" \
  /etc/systemd/system/plebeian-poc-acme.timer
install -d -o root -g root -m 0755 /etc/systemd/system/nginx.service.d
install -o root -g root -m 0644 \
  "$source_dir/nginx-override.conf" \
  /etc/systemd/system/nginx.service.d/plebeian-poc.conf

if [[ -L /etc/nginx/sites-enabled/default ]]; then
  unlink /etc/nginx/sites-enabled/default
fi
ln -sfn /etc/nginx/sites-available/plebeian-poc \
  /etc/nginx/sites-enabled/plebeian-poc

systemctl daemon-reload
systemctl unmask nginx.service
systemctl disable nginx.service plebeian-poc-acme.timer >/dev/null 2>&1 || true

test ! -e /etc/plebeian-auctions-poc/acme/certificates/172.105.64.142.key
test ! -e /etc/plebeian-auctions-poc/acme/accounts
systemctl is-active plebeian-poc-validator@1.service
systemctl is-active plebeian-poc-mint.service
systemctl is-active plebeian-poc-coordinator.service
systemctl is-active plebeian-poc-site.service
