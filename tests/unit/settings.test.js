import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConfigUrl,
  formatSettingValue,
  SETTING_DEFS,
  coerceSetting,
  defaultSettings,
  describeSettings,
  parseFlag,
  parseSettings,
  serializeSettings,
  SETTING_BY_KEY,
} from '../../src/core/settings.js';

const def = (key) => SETTING_BY_KEY[key];

test('defaults are self-consistent with their defs', () => {
  for (const d of SETTING_DEFS) {
    assert.ok(d.default !== undefined, `${d.key} has no default`);
    if (d.kind === 'float' || d.kind === 'int') {
      assert.ok(d.default >= d.min && d.default <= d.max, `${d.key} default out of range`);
    }
    if (d.kind === 'enum') assert.ok(d.values.includes(d.default), `${d.key} default not in values`);
    assert.ok(typeof d.phase === 'string' && d.phase.startsWith('m'), `${d.key} needs a milestone phase`);
  }
});

test('URL parameters override stored settings, which override defaults', () => {
  const stored = { fog: 0.008, palette: 'mist-sea', sun: 2 };
  const settings = parseSettings({ search: '?fog=0.001&seed=777', stored });
  assert.equal(settings.fog, 0.001); // URL wins
  assert.equal(settings.seed, 777);
  assert.equal(settings.palette, 'mist-sea'); // stored survives
  assert.equal(settings.sun, 2);
  assert.equal(settings.fov, def('fov').default);
});

test('out-of-range and malformed values fall back instead of producing NaN', () => {
  const settings = parseSettings({ search: '?fog=99&sun=abc&fov=&palette=nope&girl=maybe' });
  assert.equal(settings.fog, def('fog').max);
  assert.equal(settings.sun, def('sun').default);
  assert.equal(settings.fov, def('fov').default);
  assert.equal(settings.palette, def('palette').default);
  assert.equal(settings.girlPlayer, def('girlPlayer').default, 'junk must not silently change the character');
  // Every value is one of the three kinds the schema allows — and never NaN.
  for (const [key, value] of Object.entries(settings)) {
    const kind = def(key).kind;
    if (kind === 'bool') assert.equal(typeof value, 'boolean', `${key} should be a boolean`);
    else if (kind === 'enum') assert.equal(typeof value, 'string', `${key} should be a string`);
    else assert.ok(Number.isFinite(value), `${key} is ${value}`);
  }
});

test('the girl/boy toggle is a boolean, written the ways a person would', () => {
  const girl = def('girlPlayer');
  assert.equal(girl.kind, 'bool');
  assert.equal(girl.default, false, 'the boy model is the default');
  assert.equal(girl.param, 'girl', 'the URL parameter is ?girl=1');
  for (const truthy of ['1', 'true', 'on', 'yes', 'girl', 'TRUE', true, 1]) {
    assert.equal(parseSettings({ search: `?girl=${truthy}` }).girlPlayer, true, `?girl=${truthy}`);
  }
  for (const falsy of ['0', 'false', 'off', 'no', 'boy', false, 0]) {
    assert.equal(parseSettings({ search: `?girl=${falsy}` }).girlPlayer, false, `?girl=${falsy}`);
  }
  // It survives the round trip through a config link, as 1/0.
  const tuned = { ...defaultSettings(), girlPlayer: true };
  const query = serializeSettings(tuned);
  assert.equal(query, 'girl=1');
  assert.equal(parseSettings({ search: `?${query}` }).girlPlayer, true);
  assert.equal(formatSettingValue(girl, true), 'on');
  assert.equal(formatSettingValue(girl, false), 'off');
  assert.equal(formatSettingValue(girl, undefined), '—');
});

test('word seeds hash into the seed space', () => {
  const settings = parseSettings({ search: '?seed=emberdark' });
  assert.ok(Number.isInteger(settings.seed));
  assert.ok(settings.seed >= def('seed').min && settings.seed <= def('seed').max);
  assert.equal(parseSettings({ search: '?seed=emberdark' }).seed, settings.seed);
});

test('int settings are rounded, float settings are quantised to their decimals', () => {
  assert.equal(coerceSetting(def('seed'), '42.7'), 43);
  assert.equal(coerceSetting(def('fog'), '0.000123456'), 0.0001);
  assert.equal(coerceSetting(def('fov'), 72.4), 72);
});

test('serialize -> parse round-trips a tuned config', () => {
  const tuned = { ...defaultSettings(), fog: 0.0042, palette: 'cold-ridge', seed: 4242, look: 1.35 };
  const query = serializeSettings(tuned, { includeDefaults: true });
  assert.deepEqual(parseSettings({ search: `?${query}` }), tuned);

  const compact = serializeSettings(tuned);
  const parsed = parseSettings({ search: `?${compact}` });
  assert.equal(parsed.fog, 0.0042);
  assert.equal(parsed.palette, 'cold-ridge');
  assert.equal(parsed.seed, 4242);
});

test('defaults serialise to nothing at all', () => {
  assert.equal(serializeSettings(defaultSettings()), '');
  assert.equal(describeSettings(defaultSettings()), 'all defaults');
});

test('describeSettings lists only what changed', () => {
  const settings = { ...defaultSettings(), fog: 0.006 };
  assert.equal(describeSettings(settings), 'fog=0.006');
});

test('flags parse the ways a human would write them', () => {
  const params = new URLSearchParams('?debug=1&dev=true&off=0');
  assert.equal(parseFlag(params, 'debug'), true);
  assert.equal(parseFlag(params, 'dev'), true);
  assert.equal(parseFlag(params, 'off'), false);
  assert.equal(parseFlag(params, 'missing', 'fallback'), 'fallback');
});

test('every setting formats to something a human can read', () => {
  for (const d of SETTING_DEFS) {
    const text = formatSettingValue(d, d.default);
    assert.ok(text.length > 0, `${d.key} formats to nothing`);
    assert.ok(!/NaN|undefined|\[object/.test(text), `${d.key} formats to "${text}"`);
    // ...and it must survive being handed a value of the wrong type.
    const nonsense = formatSettingValue(d, undefined);
    assert.ok(!/NaN|undefined|\[object/.test(nonsense), `${d.key} formats undefined to "${nonsense}"`);
  }
});

test('mouse capture has an escape hatch, and it is on by default', () => {
  assert.equal(SETTING_BY_KEY.captureMouse.default, 'on');
  assert.equal(parseSettings({ search: '?capture=on' }).captureMouse, 'on');
  assert.equal(parseSettings({ search: '?capture=off' }).captureMouse, 'off');
  // Junk must not silently switch a control off; it falls back to the default.
  assert.equal(parseSettings({ search: '?capture=maybe' }).captureMouse, 'on');
  assert.equal(parseSettings({ search: '' }).captureMouse, 'on');
});

test('controls for milestones that have not started are declared but not live', () => {
  const future = SETTING_DEFS.filter((d) => d.live === false);
  assert.ok(future.length >= 1, 'expected the attunement swap window to be declared ahead of M6');
  assert.ok(future.every((d) => d.phase !== 'm1'), 'M1 controls must be live once M1 ships');
});

test('the owner’s playtested feel is the default (guard against a silent reset)', () => {
  // Numbers pasted back from the tuning panel on 2026-10-15, together with the
  // playtest that passed M1. If a change moves one of these, it is a decision
  // the owner has to make, not a side effect of an edit.
  const tuned = {
    seed: 1607255203,
    palette: 'cold-ridge',
    fog: 0.0026,
    sun: 2.4,
    ambient: 1.25,
    fov: 81,
    look: 3.7,
    lookMouse: 3.45,
    captureMouse: 'on',
    view: 'third',
    walkSpeed: 7.9,
    jumpHeight: 2.4,
    gravity: 30.5,
    accel: 59,
    viewBob: 0.005,
  };
  const defaults = defaultSettings();
  for (const [key, value] of Object.entries(tuned)) {
    assert.equal(defaults[key], value, `${key} default changed (was ${value})`);
  }
  // And they must survive a round trip through the URL the panel writes.
  const parsed = parseSettings({ search: buildConfigUrl(tuned).split('?')[1] });
  for (const [key, value] of Object.entries(tuned)) {
    assert.equal(parsed[key], value, `${key} did not survive the config link`);
  }
});

test('the camera controls are live in M1', () => {
  for (const key of ['view', 'camDistance']) {
    const def = SETTING_BY_KEY[key];
    assert.ok(def, `${key} is missing from the schema`);
    assert.notEqual(def.live, false, `${key} should be wired up in M1`);
    assert.equal(def.phase, 'm1');
  }
  assert.equal(SETTING_BY_KEY.view.default, 'third', 'the game is third person by default');
  assert.deepEqual(SETTING_BY_KEY.view.values, ['third', 'first']);
});

test('the M1 feel controls are live', () => {
  for (const key of ['walkSpeed', 'jumpHeight', 'gravity', 'accel', 'viewBob']) {
    const def = SETTING_BY_KEY[key];
    assert.ok(def, `${key} is missing from the schema`);
    assert.notEqual(def.live, false, `${key} should be wired up in M1`);
    assert.equal(def.phase, 'm1');
    assert.ok(def.default >= def.min && def.default <= def.max, `${key} default outside its range`);
  }
});
