import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {localEasternToUtc, parseBlsSchedule, parseFedCalendar,
  parseFedConferenceMinutesTime, parseFedStatement,
  parseNvidiaEarnings} from '../src/phase14-events.ts';

test('BLS toma fecha de publicación y hora real Eastern, incluidas transiciones EST/EDT', () => {
  const html = `<p>NOTE: All times on calendar are Eastern Time.</p><table>
    <tr><td class="date-cell"><p>Friday, March 6, 2026</p></td>
    <td class="time-cell"><p>08:30 AM</p></td>
    <td class="desc-cell"><p><strong>Employment Situation</strong> for February 2026</p></td></tr>
    <tr><td class="date-cell"><p>Wednesday, March 11, 2026</p></td>
    <td class="time-cell"><p>08:30 AM</p></td>
    <td class="desc-cell"><p><strong>Consumer Price Index</strong> for February 2026</p></td></tr>
    <tr><td class="date-cell"><p>Thursday, March 12, 2026</p></td>
    <td class="time-cell"><p>&nbsp;</p></td>
    <td class="desc-cell"><p><strong>Consumer Price Index</strong> for March 2026</p></td></tr>
    <tr><td class="date-cell"><p>Friday, March 13, 2026</p></td>
    <td class="time-cell"><p>10:00 AM</p></td>
    <td class="desc-cell"><p><strong>Employment Situation</strong> of Veterans</p></td></tr></table>`;
  const events = parseBlsSchedule(html, 2026, 'https://www.bls.gov/schedule/2026/home.htm');
  assert.equal(events.length, 3);
  assert.equal(events[0]!.timestampUtc, '2026-03-06T13:30:00.000Z');
  assert.equal(events[1]!.timestampUtc, '2026-03-11T12:30:00.000Z');
  assert.equal(events[2]!.verification, 'date_without_time');
  assert.equal(events[2]!.availableAtUtc, null);
  assert.equal(localEasternToUtc('2026-11-01', '01:30'), null);
});

test('FOMC separa comunicado, conferencia y actas posteriores sin inventar hora de conferencia', () => {
  const html = `<a href="/newsevents/pressreleases/monetary20250129a.htm">Statement</a>
    <a href="/monetarypolicy/fomcpresconf20250129.htm">Press Conference</a>
    <a href="/monetarypolicy/fomcminutes20250129.htm">HTML</a>
    <br> (Released February 19, 2025)`;
  const entries = parseFedCalendar(html);
  assert.equal(entries.statement.length, 1);
  assert.equal(entries.conference.length, 1);
  assert.equal(entries.minutes[0]!.releaseDate, '2025-02-19');
  const statement = parseFedStatement('<p class="releaseTime">For release at 2:00 p.m. EST</p>',
    '2025-01-29', entries.statement[0]!.url);
  assert.equal(statement.timestampUtc, '2025-01-29T19:00:00.000Z');
  const minutesTime = parseFedConferenceMinutesTime(
    'Minutes: Released February 19, 2025 at 2:00 p.m.', '2025-02-19');
  assert.equal(minutesTime, '14:00');
  assert.equal(parseFedStatement('<p>For release at 2:00 p.m.</p>',
    '2025-01-29', entries.statement[0]!.url).timestampUtc, null);
});

test('NVIDIA conserva fecha publicada y no confunde conferencia con hora de resultados', () => {
  const html = `<meta property="og:title" content="NVIDIA Announces Financial Results for Third Quarter Fiscal 2025">
    ga_four_event('PublishDate','View','November 20, 2024');
    <p>Conference call 5:00 p.m. ET</p>`;
  const event = parseNvidiaEarnings(html, 'https://nvidianews.nvidia.com/news/earnings');
  assert.equal(event?.dateNy, '2024-11-20');
  assert.equal(event?.timestampUtc, null);
  assert.equal(event?.consensus, null);
  assert.equal(event?.surprise, null);
});
