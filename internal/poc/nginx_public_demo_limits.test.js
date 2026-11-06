const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, '../../deploy/sidequest-mvp/nginx-public-demo-limits-r2.conf');
const config = fs.readFileSync(configPath, 'utf8');

function mutationMaps() {
  return [...config.matchAll(/map "\$request_method:\$uri" \$plebeian_friday_mutation_(?:ip|global) \{([\s\S]*?)\n\}/g)]
    .map(match => match[1]);
}

test('ordinary methods and exact body-bound POST reads do not consume the mutation budget', () => {
  const maps = mutationMaps();
  assert.equal(maps.length, 2);
  for (const body of maps) {
    assert.match(body, /\(\?:GET\|HEAD\|OPTIONS\): "";/);
    assert.match(body, /auction-funding\/read/);
    assert.match(body, /auction-payout\/\(\?:read\|winner\)/);
    assert.match(body, /seller-plan\/\(\?:challenge\|pending\|read\)/);
    assert.match(body, /terminal\/read/);
    assert.match(body, /funding\/status/);
    assert.match(body, /funding-abort\/status/);
  }
});

test('unknown POSTs and mutations remain limited by the dedicated mutation zones', () => {
  const maps = mutationMaps();
  assert.match(maps[0], /default \$binary_remote_addr;/);
  assert.match(maps[1], /default public-demo;/);
  assert.match(config, /limit_req_zone \$plebeian_friday_mutation_ip zone=plebeian_friday_mutation_ip:/);
  assert.match(config, /limit_req_zone \$plebeian_friday_mutation_global zone=plebeian_friday_mutation_global:/);
  assert.doesNotMatch(config, /limit_req_zone \$binary_remote_addr zone=plebeian_friday_mutation_ip:/);
});
