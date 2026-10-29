const BUTTON_ACTIONS = {
  0: 'interact',
  1: 'back',
  2: 'target',
  3: 'potion',
  4: 'skill1',
  5: 'skill2',
  6: 'skill3',
  7: 'skill4',
  8: 'map',
  9: 'menu',
  10: 'skill5',
  11: 'skill6',
  12: 'nav_up',
  13: 'nav_down',
  14: 'nav_left',
  15: 'nav_right',
};

export const GAMEPAD_HELP = [
  ['Left stick / D-pad', 'walk'], ['A / Cross', 'talk / use portal'], ['X / Square', 'next target'],
  ['Y / Triangle', 'health potion'], ['LB RB LT RT L3 R3', 'skills 1-6'], ['B / Circle', 'back'],
  ['View / Share', 'world map'], ['Menu / Options', 'menu'],
];

export function applyRadialDeadzone(x, y, deadzone = 0.24) {
  const mag = Math.min(1, Math.hypot(x, y));
  if (mag <= deadzone) return { x: 0, y: 0 };
  const scaled = (mag - deadzone) / (1 - deadzone);
  return { x: (x / mag) * scaled, y: (y / mag) * scaled };
}

export function moveFocusIndex(current, length, direction) {
  if (length <= 0) return -1;
  const start = current >= 0 && current < length ? current : (direction > 0 ? -1 : 0);
  return (start + direction + length) % length;
}

export function readGamepad(gamepad, previousButtons = [], deadzone = 0.24) {
  const held = new Set();
  const pressed = new Set();
  const buttons = Array.from(gamepad.buttons || [], (value) => !!(value && (value.pressed || value.value > 0.5)));
  const stick = applyRadialDeadzone(Number(gamepad.axes?.[0] || 0), Number(gamepad.axes?.[1] || 0), deadzone);

  if (stick.y < -0.35 || buttons[12]) held.add('move_up');
  if (stick.y > 0.35 || buttons[13]) held.add('move_down');
  if (stick.x < -0.35 || buttons[14]) held.add('move_left');
  if (stick.x > 0.35 || buttons[15]) held.add('move_right');

  for (const [indexText, action] of Object.entries(BUTTON_ACTIONS)) {
    const index = Number(indexText);
    if (buttons[index] && !previousButtons[index]) pressed.add(action);
  }
  return { held, pressed, buttons };
}
