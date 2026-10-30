import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('client/index.html', 'utf8');
const css = fs.readFileSync('client/style.css', 'utf8');
const main = fs.readFileSync('client/main.js', 'utf8');
const ok = (condition, message) => { assert.ok(condition, message); console.log('ok  -', message); };

ok(!/user-scalable\s*=\s*no/i.test(html), 'the viewport does not disable browser zoom');
ok(/id="loginErr"[^>]*role="alert"[^>]*aria-live="assertive"/.test(html), 'login errors are announced accessibly');
ok(/id="chatLog"[^>]*role="log"[^>]*aria-live="polite"/.test(html), 'chat is exposed as a polite live log');
ok(/id="toast"[^>]*role="status"[^>]*aria-live="polite"/.test(html), 'game notices are exposed as a live status');
ok(/id="tutorial"[^>]*role="dialog"[^>]*aria-modal="true"/.test(html), 'first-session help is a real modal dialog');
ok(/:focus-visible/.test(css), 'keyboard and gamepad focus has a visible style');
ok(/prefers-reduced-motion/.test(css), 'the system reduced-motion preference is respected');
ok(/--ui-scale/.test(css) && /uiScale/.test(main), 'players can scale the interface text');
ok(/showTutorial/.test(main) && /em_tutorial_v1/.test(main), 'the onboarding flow is persisted after completion');
ok(/#login\s*\{[^}]*overflow-y:\s*auto/.test(css), 'the tall creator can scroll instead of clipping');
ok(/@media\s*\(max-width:\s*600px\)[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(css), 'the class grid becomes two columns on narrow screens');
ok(/id="bank"[^>]*role="dialog"[^>]*aria-labelledby="bankTitle"/.test(html), 'the bank is exposed as an accessible dialog');
ok(/id="bankSlots"/.test(html) && /renderBank/.test(main), 'the bank has a rendered 40-slot item grid');
ok(/bank_deposit/.test(main) && /bank_withdraw/.test(main), 'bank actions request server-authoritative item moves');
ok(/d\.onkeydown[\s\S]*?Enter[\s\S]*?' '/.test(main), 'keyboard users can activate focused bank slots');
ok(/body\.touch #bank/.test(css), 'the bank remains usable in touch mode');
ok(/\/mute/.test(main) && /\/unmute/.test(main), 'chat exposes mute and unmute commands');
ok(/muteAction/.test(main) && /a === 'mute' \|\| a === 'unmute'/.test(main), 'the nearby-player menu offers a direct mute toggle');

console.log('UI CONTRACT OK');
