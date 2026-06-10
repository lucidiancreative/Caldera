import test from 'node:test';
import assert from 'node:assert/strict';

import { arcPath, fitArcLabel, minutesFromPoint } from '../src/react/schedule/clock';

test('should produce no path for a zero-length span', () => {
  assert.equal(arcPath(200, 200, 105, 145, 120, 120), '');
});

test('should draw a sharp wedge with arc commands when rounding is off', () => {
  const d = arcPath(200, 200, 105, 145, 0, 180, 0);
  assert.match(d, /^M /);
  assert.ok(d.includes('A 145 145') && d.includes('A 105 105'));
  assert.ok(!d.includes('Q')); // no rounded corners
});

test('should add rounded corners (quadratic curves) when a radius is given', () => {
  const d = arcPath(200, 200, 105, 145, 0, 180, 6);
  assert.ok(d.includes('Q'));
});

test('should map clock-face points to the nearest 15-minute mark from 12 o\'clock', () => {
  // cx/cy = 200; 0 minutes points straight up.
  assert.equal(minutesFromPoint(200, 200, 200, 50), 0);    // top → 12:00
  assert.equal(minutesFromPoint(200, 200, 350, 200), 180); // right → 3:00
  assert.equal(minutesFromPoint(200, 200, 200, 350), 360); // bottom → 6:00
  assert.equal(minutesFromPoint(200, 200, 50, 200), 540);  // left → 9:00
});

test('should truncate an over-long arc label with an ellipsis', () => {
  const fitted = fitArcLabel('A very long block label that will not fit', 30, 125);
  assert.ok(fitted.endsWith('…'));
  assert.ok(fitted.length < 'A very long block label that will not fit'.length);
});
