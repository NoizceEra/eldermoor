import assert from 'node:assert/strict';
import {
  AttemptLimiter,
  hashSecret,
  isAllowedOrigin,
  securityHeaders,
  validateNewSecret,
  verifySecret,
} from '../server/security.js';

const ok = (condition, message) => {
  assert.ok(condition, message);
  console.log('ok  -', message);
};

ok(!validateNewSecret('').ok, 'new heroes cannot use an empty secret');
ok(!validateNewSecret('abc').ok, 'new hero secrets have a minimum length');
ok(validateNewSecret('four').ok, 'a four-character secret is accepted');
ok(!validateNewSecret('x'.repeat(65)).ok, 'new hero secrets have a maximum length');

const salt = '0011223344556677';
const hash = await hashSecret('correct horse', salt);
ok(await verifySecret('correct horse', salt, hash), 'the correct secret verifies');
ok(!(await verifySecret('wrong horse', salt, hash)), 'the wrong secret is rejected');
ok(!(await verifySecret('correct horse', salt, 'not-a-valid-hash')), 'malformed stored hashes fail closed');

let now = 1000;
const limiter = new AttemptLimiter({ limit: 3, windowMs: 1000, blockMs: 2000, now: () => now });
ok(limiter.check('ip|hero').ok, 'a fresh login key is allowed');
limiter.fail('ip|hero'); limiter.fail('ip|hero');
ok(limiter.check('ip|hero').ok, 'attempts below the limit remain allowed');
limiter.fail('ip|hero');
ok(!limiter.check('ip|hero').ok, 'the login key is blocked at the failure limit');
now += 2001;
ok(limiter.check('ip|hero').ok, 'the login block expires');
limiter.fail('ip|hero'); limiter.clear('ip|hero');
ok(limiter.check('ip|hero').ok, 'a successful login clears prior failures');

ok(isAllowedOrigin(undefined, 'localhost:3000', ''), 'non-browser clients without Origin remain supported');
ok(isAllowedOrigin('http://localhost:3000', 'localhost:3000', ''), 'same-origin local WebSockets are accepted');
ok(!isAllowedOrigin('https://evil.example', 'eldermoor.example', ''), 'cross-origin browser WebSockets are rejected');
ok(isAllowedOrigin('https://play.example', 'eldermoor.example', 'https://play.example'), 'an explicit origin allowlist is supported');
ok(!isAllowedOrigin('https://other.example', 'eldermoor.example', 'https://play.example'), 'the explicit allowlist rejects unlisted origins');

const headers = securityHeaders();
ok(headers['x-content-type-options'] === 'nosniff', 'HTTP responses disable MIME sniffing');
ok(headers['content-security-policy'].includes("frame-ancestors 'none'"), 'HTTP responses cannot be framed');
ok(headers['permissions-policy'].includes('camera=()'), 'unused browser permissions are disabled');

console.log('SECURITY UNIT OK');
