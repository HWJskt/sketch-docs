// src/xlsx/losses.ts: the warning before saving over the opened file names what goes, with the names measured
// in docs/xlsx-roundtrip-losses.md (decision Q2 ②).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describeLosses, MEASURED, structureOf, STRUCTURE_WARNING } from '../src/xlsx/losses.ts';

const doc = await readFile(new URL('../docs/xlsx-roundtrip-losses.md', import.meta.url), 'utf8');
const d = (area, key, before, after) => ({ area, key, before: before === undefined ? undefined : typeof before === 'string' ? before : JSON.stringify(before), after: after === undefined ? undefined : typeof after === 'string' ? after : JSON.stringify(after) });
const style = (extra = {}) => JSON.stringify({ font: { name: 'Calibri' }, ...extra });

test('the names are those the measurement lists, one for one', () => {
    const section = doc.slice(doc.indexOf('**저장 전 경고에 쓸 요소 이름**'), doc.indexOf('- 원본 저장을 막을 손실'));
    const listed = [...section.matchAll(/^ {2}- (.+)$/gm)].map(m => m[1].trim());
    assert.ok(listed.length >= 10, `${listed.length} names read from the document`);
    assert.deepEqual([...listed].sort(), Object.values(MEASURED).sort());
});

test('each measured loss is named by its measured name, with how many places', () => {
    const lines = describeLosses([
        d('document', 'created', '2024-01-01T00:00:00Z', undefined),
        d('rich-text', '매출!A7', [['보통', null], ['굵은', [['b', {}]]]], undefined),
        d('rich-text', '매출!A8', [['x', null]], undefined),
        d('protection', '보호', { sheet: '1' }, { sheet: '1', objects: '1', scenarios: '1' }),
        d('part-kind', 'application/vnd.ms-office.vbaProject', '1', undefined),
        d('part-kind', 'application/vnd.ms-office.chartstyle+xml', '1', undefined),
        d('part-kind', 'application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml', '1', undefined),
        d('cell', '매출!B2', { kind: 'string', value: 'a\r\nb', style: style() }, { kind: 'string', value: 'a\nb', style: style() }),
        d('cell', '매출!C2', { kind: 'n', value: '1', style: style({ alignment: { vertical: 'center' } }) }, { kind: 'n', value: '1', style: style() }),
        d('cell', '매출!D2', { kind: 'n', formula: 'SEQUENCE(3)', array: 'D2', style: style() }, { kind: 'n', formula: 'SEQUENCE(3)', style: style() }),
        d('conditional-format', '매출!A1:A9', [{ type: 'cellIs' }, { type: 'top10' }], [{ type: 'cellIs' }]),
        d('chart', '매출@1:1', '{"kinds":[1]}', '{"kinds":[2]}'),
        d('shape', '매출@2:2', { kind: ['grpSp'] }, undefined),
        d('hyperlink', '매출!E2', { target: 'https://a.example', display: '홈' }, { target: 'https://a.example' }),
        d('sheet-props', '매출', { fit: { autoPageBreaks: '0' } }, {}),
        d('print', '매출', { setup: { horizontalDpi: '300', paperSize: '9' } }, { setup: { paperSize: '9' } }),
        d('workbook', 'extensions', ['{140A7094-0E35-4892-8432-C4D2E57EDEB5}'], undefined),
        d('column', '매출!A', { width: '10.71' }, { width: '10.65' }),
    ]);
    assert.deepEqual(lines, [
        '조건부 서식 규칙 1범위', '차트 계열 종류(콤보 차트) 1개', '차트 스타일 1개', '셀 맞춤(세로) 1셀', '동적 배열 수식 1셀',
        '그룹 도형·연결선 1개', '셀 안 부분 서식 2곳', '줄 바꿈 문자(CR) 1셀', '하이퍼링크 표시 텍스트 1개', '시트 보호 옵션 1시트',
        '인쇄 설정(자동 쪽 나눔) 1시트', '인쇄 설정(DPI) 1시트', '통합 문서 확장 1개', '매크로(VBA)', '만든 날짜', '열 너비(미세) 1열',
    ]);
});

test('a difference no measured name fits still shows, by its area; an unread part kind is unknown content', () => {
    assert.deepEqual(describeLosses([
        d('note', '매출!A1', { text: '메모' }, undefined),
        d('cell', '매출!A2', { kind: 'n', value: '1' }, { kind: 'n', value: '2' }),
        d('column', '매출!B', { width: '10' }, { width: '20' }),
        d('part-kind', 'application/x-pivot', '2', undefined),
        d('somewhere-new', 'x', '1', undefined),
    ]), ['메모 1개', '셀 값·수식 1셀', '열 너비·숨김 1열', '이 프로그램이 알 수 없는 내용 2개']);
});

test('nothing lost: no lines; what the engine said on opening is added, in Korean', () => {
    assert.deepEqual(describeLosses([]), []);
    assert.deepEqual(describeLosses([], ['grouped shapes are not supported and were skipped']), ['열 때 알린 내용: 그룹 도형은 지원하지 않아 건너뛰었습니다.']);
});

test('structure is the sheet list and defined names only', () => {
    const base = new Map([['workbook|sheets', '[["매출","visible"]]'], ['name|합계', '{"value":"매출!B4"}'], ['cell|매출!A1', '{"value":"1"}']]);
    const valueEdit = new Map([...base, ['cell|매출!A1', '{"value":"2"}']]);
    const renamed = new Map([...base, ['workbook|sheets', '[["판매","visible"]]']]);
    assert.equal(structureOf(valueEdit), structureOf(base), 'a value edit is not a structure change');
    assert.notEqual(structureOf(renamed), structureOf(base));
    assert.notEqual(structureOf(new Map([...base, ['name|새이름', '{"value":"A1"}']])), structureOf(base));
    assert.match(STRUCTURE_WARNING, /셀 참조가 맞지 않을 수 있음/);
});

test('the engine\'s opening warnings show in Korean; one not in the list shows as said, marked', async () => {
    const { knownWarning, warningText } = await import('../src/xlsx/engineWarnings.ts');
    assert.equal(knownWarning('grouped shapes are not supported and were skipped'), '그룹 도형은 지원하지 않아 건너뛰었습니다.');
    assert.equal(knownWarning('links to external workbooks were kept; they are not followed or refreshed'), '다른 통합 문서와의 연결은 남겼지만 따라가거나 새로 고치지 않습니다.');
    assert.equal(knownWarning('sheet "매출": 3 cells or rows outside the 1,048,576 × 16,384 grid were dropped'), '시트 "매출": 표 범위(1,048,576행 × 16,384열) 밖의 셀·행 3개를 뺐습니다.');
    assert.equal(knownWarning('missing picture xl/media/image1.png'), '그림 파일이 없습니다(xl/media/image1.png).');
    assert.equal(warningText('a brand new warning'), '엔진 알림(번역 없음): a brand new warning');
    assert.deepEqual(describeLosses([], ['macros (VBA project) were kept but not executed']), ['열 때 알린 내용: 매크로(VBA)는 실행하지 않았습니다. .xlsx로 저장하면 매크로는 빠집니다.']);
});

// Against the engine's own source, when the upstream clone is here (not in CI): every warning its .xlsx reader
// can give is in the list. A new one after an engine update fails this until it is translated.
const engineSource = new URL('../source/gridcraft/crates/xlsx/src/', import.meta.url);
const { existsSync } = await import('node:fs');
test('every .xlsx reader warning in the engine source is translated', { skip: !existsSync(engineSource) && 'source/gridcraft is not here' }, async () => {
    const { knownWarning } = await import('../src/xlsx/engineWarnings.ts');
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(engineSource)).filter(f => f.endsWith('.rs') && !['xlsb.rs', 'ods.rs'].includes(f));
    const untranslated = [];
    let count = 0;
    for (const file of files) {
        const text = await readFile(new URL(file, engineSource), 'utf8');
        for (const m of text.matchAll(/\.warn\(\s*(?:format!\(\s*)?"((?:[^"\\]|\\.)*)"/g)) {
            // Parameters become a sample value that fits both words and numbers.
            const sample = m[1].replace(/\\"/g, '"').replace(/\{[^}]*\}/g, '7');
            count++;
            if (!knownWarning(sample)) untranslated.push(`${file}: ${sample}`);
        }
    }
    assert.ok(count >= 60, `${count} warnings read from the source`);
    assert.deepEqual(untranslated, []);
});
