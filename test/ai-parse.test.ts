import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterEventsByDateRange,
  isLikelyHomepage,
  isValidCalendarDate,
  parseEventText,
  sanitizeSourceUrl,
  tryParseJsonArray,
} from '../src/ai/parse';

test('should accept real calendar dates and reject malformed ones', () => {
  assert.equal(isValidCalendarDate('2024-02-29'), true);
  assert.equal(isValidCalendarDate('2024-02-30'), false);
  assert.equal(isValidCalendarDate('2024/02/29'), false);
});

test('should keep only http and https source URLs', () => {
  assert.equal(sanitizeSourceUrl('https://example.com/event'), 'https://example.com/event');
  assert.equal(sanitizeSourceUrl('http://example.com/show'), 'http://example.com/show');
  assert.equal(sanitizeSourceUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeSourceUrl('file:///secret.txt'), '');
});

test('should flag obvious homepages and listings as non-specific links', () => {
  assert.equal(isLikelyHomepage('https://example.com/'), true);
  assert.equal(isLikelyHomepage('https://example.com/events'), true);
  assert.equal(isLikelyHomepage('https://example.com/events/summer-fest'), false);
});

test('should parse complete and repaired JSON arrays', () => {
  assert.deepEqual(tryParseJsonArray('[{"title":"A"}]'), [{ title: 'A' }]);
  assert.deepEqual(tryParseJsonArray('[{"title":"A"'), [{ title: 'A' }]);
  assert.equal(tryParseJsonArray('not json'), null);
});

test('should parse fenced AI responses and drop malformed events', () => {
  const result = parseEventText(
    '```json\n' +
      '[\n' +
      '  {"title":"Summer Fest","date":"2026-07-04","time":"19:30","notes":"Live music","sourceUrl":"https://example.com/events/summer-fest"},\n' +
      '  {"title":"Bad Date","date":"2026-02-30","time":"19:30","notes":"Ignore me","sourceUrl":"https://example.com/events/bad-date"},\n' +
      '  {"title":"Unsafe Link","date":"2026-08-01","time":null,"notes":"","sourceUrl":"javascript:alert(1)"}\n' +
      ']\n' +
      '```',
    'Test',
  );

  assert.equal(result.error, undefined);
  assert.equal(result.events?.length, 2);
  assert.deepEqual(result.events?.[0], {
    title: 'Summer Fest',
    date: '2026-07-04',
    time: '19:30',
    notes: 'Live music',
    sourceUrl: 'https://example.com/events/summer-fest',
  });
  assert.deepEqual(result.events?.[1], {
    title: 'Unsafe Link',
    date: '2026-08-01',
    time: null,
    notes: '',
    sourceUrl: '',
  });
});

test('should return a malformed-json error when repair fails', () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = parseEventText('[{"title"', 'Test');
    assert.equal(result.error, 'Test returned malformed JSON.');
  } finally {
    console.error = originalConsoleError;
  }
});

test('should filter events inclusively by configured date range', () => {
  const result = filterEventsByDateRange({
    events: [
      { title: 'Early', date: '2026-06-01', time: null, notes: '', sourceUrl: '' },
      { title: 'Inside', date: '2026-06-15', time: null, notes: '', sourceUrl: '' },
      { title: 'Late', date: '2026-07-01', time: null, notes: '', sourceUrl: '' },
    ],
  }, '2026-06-10', '2026-06-30');

  assert.deepEqual(result.events?.map(event => event.title), ['Inside']);
});
