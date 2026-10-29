import assert from 'node:assert/strict';
import { applyRadialDeadzone, moveFocusIndex, readGamepad } from '../client/input.js';

const ok = (condition, message) => { assert.ok(condition, message); console.log('ok  -', message); };
const button = (pressed = false, value = pressed ? 1 : 0) => ({ pressed, value });
const pad = ({ axes = [0, 0], buttons = [] } = {}) => ({ axes, buttons: Array.from({ length: 16 }, (_, i) => buttons[i] || button()) });

const still = applyRadialDeadzone(0.1, 0.1, 0.24);
ok(still.x === 0 && still.y === 0, 'small stick drift is removed');
const moved = applyRadialDeadzone(0.7, 0, 0.24);
ok(moved.x > 0.5 && moved.x <= 1 && moved.y === 0, 'stick motion is rescaled outside the deadzone');

let state = readGamepad(pad({ axes: [0, -0.8], buttons: { 0: button(true), 5: button(true) } }), [], 0.24);
ok(state.held.has('move_up'), 'left-stick up maps to move_up');
ok(state.pressed.has('interact'), 'south face button maps to interact on its press edge');
ok(state.pressed.has('skill2'), 'right bumper maps to skill2');

state = readGamepad(pad({ axes: [0, -0.8], buttons: { 0: button(true), 5: button(true) } }), state.buttons, 0.24);
ok(state.held.has('move_up'), 'held movement remains active every frame');
ok(!state.pressed.has('interact') && !state.pressed.has('skill2'), 'held buttons do not retrigger discrete actions');

state = readGamepad(pad({ buttons: { 1: button(true), 8: button(true), 9: button(true), 10: button(true), 11: button(true) } }), [], 0.24);
ok(state.pressed.has('back') && state.pressed.has('map') && state.pressed.has('menu'), 'back, map and menu buttons are mapped');
ok(state.pressed.has('skill5') && state.pressed.has('skill6'), 'stick buttons expose the final two skill slots');

state = readGamepad(pad({ buttons: { 12: button(true), 13: button(true) } }), [], 0.24);
ok(state.pressed.has('nav_up') && state.pressed.has('nav_down'), 'D-pad edges are available for menu focus navigation');

ok(moveFocusIndex(0, 3, 1) === 1, 'menu focus advances');
ok(moveFocusIndex(2, 3, 1) === 0, 'menu focus wraps forward');
ok(moveFocusIndex(0, 3, -1) === 2, 'menu focus wraps backward');

console.log('INPUT UNIT OK');
