// src/xlsx/xml.ts and src/xlsx/compare.ts: the same content written differently compares equal; a change or
// a loss does not (docs/plans/2026-10-15-xlsx-edit.md §3.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { parseXml, attr, allText } from '../src/xlsx/xml.ts';
import { compareWorkbooks, readWorkbook, shiftFormula } from '../src/xlsx/compare.ts';
import { koreanWorkbook } from './xlsx-fixtures.mjs';

test('the XML reader decodes entities and CDATA, keeps prefixes apart, and refuses what is not well formed', () => {
    const root = parseXml('<?xml version="1.0"?><!-- c --><x:a xmlns:x="u" r:id="rId1" note="a &gt; b &amp; &#xAC00;&#44032;"><b>1 &lt; 2</b><![CDATA[<raw>]]><c/></x:a>');
    assert.equal(root.local, 'a');
    assert.equal(root.name, 'x:a');
    assert.equal(attr(root, 'id'), 'rId1');
    assert.equal(attr(root, 'note'), 'a > b & 가가');
    assert.equal(allText(root), '<raw>1 < 2');
    assert.equal(root.children.length, 2);
    assert.throws(() => parseXml('<a><b></a></b>'), /does not close/);
    assert.throws(() => parseXml('<a>'), /not closed/);
    assert.throws(() => parseXml('<!DOCTYPE a><a/>'), /DOCTYPE/);
    assert.throws(() => parseXml('<a>&bogus;</a>'), /entity/);
    assert.equal(attr(parseXml(`<a v='x>y'/>`), 'v'), 'x>y', 'a ">" inside a quoted value');
});

test('a shared formula moves its relative references, not anchored ones or text', () => {
    assert.equal(shiftFormula('SUM(A1:B2)*$C$1+"A1"', 2, 1), 'SUM(B3:C4)*$C$1+"A1"');
    assert.equal(shiftFormula('A$1+$A1+Sheet2!B2+LOG10(4)', 1, 1), 'B$1+$A2+Sheet2!C3+LOG10(4)');
    assert.equal(shiftFormula('A1', -1, 0), '#REF!');
});

// The package as files, changed by `edit`, zipped again.
const variant = (bytes, edit) => { const files = unzipSync(bytes); edit(files); return zipSync(files); };
const text = (files, name) => strFromU8(files[name]);
const put = (files, name, value) => { files[name] = strToU8(value); };

test('the same workbook written differently compares equal', () => {
    const original = koreanWorkbook();
    assert.deepEqual(compareWorkbooks(original, original), []);
    // Parts renamed and reached through their relationships.
    const renamed = variant(original, files => {
        files['xl/worksheets/first.xml'] = files['xl/worksheets/sheet1.xml']; delete files['xl/worksheets/sheet1.xml'];
        put(files, 'xl/_rels/workbook.xml.rels', text(files, 'xl/_rels/workbook.xml.rels').replace('worksheets/sheet1.xml', 'worksheets/first.xml'));
        put(files, '[Content_Types].xml', text(files, '[Content_Types].xml').replace('/xl/worksheets/sheet1.xml', '/xl/worksheets/first.xml'));
    });
    assert.deepEqual(compareWorkbooks(original, renamed), []);
    // Styles renumbered: the bold format moves from index 1 to 2 behind an unused one.
    const bold = variant(original, files => put(files, 'xl/worksheets/sheet1.xml', text(files, 'xl/worksheets/sheet1.xml').replace('<c r="A1" t="inlineStr">', '<c r="A1" s="1" t="inlineStr">')));
    const renumbered = variant(bold, files => {
        put(files, 'xl/styles.xml', text(files, 'xl/styles.xml').replace('<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'));
        put(files, 'xl/worksheets/sheet1.xml', text(files, 'xl/worksheets/sheet1.xml').replace('<c r="A1" s="1"', '<c r="A1" s="2"'));
    });
    assert.deepEqual(compareWorkbooks(bold, renumbered), []);
    // A shared string instead of an inline one; a built-in number format spelled out.
    const sharedStrings = variant(original, files => {
        put(files, 'xl/worksheets/sheet2.xml', text(files, 'xl/worksheets/sheet2.xml').replace('<c r="A1" t="inlineStr"><is><t>메모</t></is></c>', '<c r="A1" t="s"><v>0</v></c>'));
        put(files, 'xl/sharedStrings.xml', '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>메모</t></si></sst>');
        put(files, 'xl/_rels/workbook.xml.rels', text(files, 'xl/_rels/workbook.xml.rels').replace('</Relationships>', '<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'));
    });
    const sharedDiff = compareWorkbooks(original, sharedStrings).map(d => d.area);
    assert.deepEqual(sharedDiff, [], 'the cell compares equal (no shared-strings content type is declared, so no part kind is added)');
    // A shared formula written out in full in its dependent cell.
    const sheet = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" si="0" ref="B1:B2">A1*2</f><v>2</v></c></row><row r="2"><c r="A2"><v>3</v></c><c r="B2"><f t="shared" si="0"/><v>6</v></c></row></sheetData></worksheet>';
    const sharedFormula = variant(original, files => put(files, 'xl/worksheets/sheet2.xml', sheet));
    const fullFormula = variant(original, files => put(files, 'xl/worksheets/sheet2.xml', sheet.replace('<f t="shared" si="0" ref="B1:B2">A1*2</f>', '<f>A1*2</f>').replace('<f t="shared" si="0"/>', '<f>A2*2</f>')));
    assert.deepEqual(compareWorkbooks(sharedFormula, fullFormula), []);
});

test('a change or a loss is reported where it happened', () => {
    const original = koreanWorkbook();
    const changed = variant(original, files => put(files, 'xl/worksheets/sheet1.xml', text(files, 'xl/worksheets/sheet1.xml').replace('<v>1200</v>', '<v>1300</v>')));
    assert.deepEqual(compareWorkbooks(original, changed).map(d => [d.area, d.key]), [['cell', '매출!B2']]);
    const formula = variant(original, files => put(files, 'xl/worksheets/sheet1.xml', text(files, 'xl/worksheets/sheet1.xml').replace('SUM(B2:B3)', 'SUM(B2:B2)')));
    assert.deepEqual(compareWorkbooks(original, formula).map(d => d.key), ['매출!B4']);
    const dropped = variant(original, files => {
        put(files, 'xl/worksheets/sheet1.xml', text(files, 'xl/worksheets/sheet1.xml').replace('</sheetData>', '</sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells><dataValidations count="1"><dataValidation type="whole" sqref="B2"><formula1>0</formula1></dataValidation></dataValidations>'));
    });
    assert.deepEqual(compareWorkbooks(dropped, original).map(d => d.area).sort(), ['merge', 'validation'], 'merges and validation lost on the way');
    const styled = variant(original, files => put(files, 'xl/styles.xml', text(files, 'xl/styles.xml').replace('<b/><sz val="11"/>', '<b/><i/><sz val="11"/>')));
    const bold = variant(original, files => put(files, 'xl/worksheets/sheet1.xml', text(files, 'xl/worksheets/sheet1.xml').replace('<c r="A1" t="inlineStr">', '<c r="A1" s="1" t="inlineStr">')));
    const boldItalic = variant(styled, files => put(files, 'xl/worksheets/sheet1.xml', text(files, 'xl/worksheets/sheet1.xml').replace('<c r="A1" t="inlineStr">', '<c r="A1" s="1" t="inlineStr">')));
    assert.deepEqual(compareWorkbooks(bold, boldItalic).map(d => d.key), ['매출!A1'], 'a format compares by what it resolves to');
    const extraPart = variant(original, files => {
        put(files, 'customXml/item1.xml', '<data/>');
        put(files, '[Content_Types].xml', text(files, '[Content_Types].xml').replace('</Types>', '<Override PartName="/customXml/item1.xml" ContentType="application/vnd.example.custom+xml"/></Types>'));
    });
    assert.deepEqual(compareWorkbooks(extraPart, original).map(d => [d.area, d.key]), [['part-kind', 'application/vnd.example.custom+xml']], 'a part nothing else reads still counts');
    assert.throws(() => readWorkbook(variant(original, files => delete files['_rels/.rels'])), /No workbook/);
});

test('spellings of the same meaning compare equal: defaults, booleans, quotes, exponents, automatic colours', () => {
    const original = koreanWorkbook();
    const spelled = (sheetTail, formulaText = 'SUM(B2:B3)') => variant(original, files => put(files, 'xl/worksheets/sheet1.xml', text(files, 'xl/worksheets/sheet1.xml').replace('SUM(B2:B3)', formulaText).replace('</sheetData>', '</sheetData>' + sheetTail)));
    assert.deepEqual(compareWorkbooks(
        spelled('<sheetProtection sheet="1" objects="0" selectLockedCells="0"/><dataValidations count="1"><dataValidation type="whole" operator="between" allowBlank="0" sqref="B2"><formula1>1</formula1></dataValidation></dataValidations><pageMargins left="0.3" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup orientation="portrait"/>', "SUM('매출'!B2:B3)"),
        spelled('<sheetProtection sheet="true"/><dataValidations count="1"><dataValidation sqref="B2" type="whole"><formula1>1</formula1></dataValidation></dataValidations><pageMargins left="0.30000001192092896" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup/>', 'SUM(매출!B2:B3)')), []);
    assert.deepEqual(compareWorkbooks(spelled('<sheetProtection sheet="1"/>'), spelled('<sheetProtection sheet="1" objects="1"/>')).map(d => d.area), ['protection'], 'a value off its default still counts');
    const exponent = value => variant(original, files => put(files, 'xl/worksheets/sheet1.xml', text(files, 'xl/worksheets/sheet1.xml').replace('<v>1200</v>', `<v>${value}</v>`)));
    assert.deepEqual(compareWorkbooks(exponent('1.5e-05'), exponent('1.5E-5')), []);
    assert.deepEqual(compareWorkbooks(exponent('1.5e-05'), exponent('1.6E-5')).length, 1);
});

test('every committed round-trip fixture is readable and equal to itself', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('./fixtures/xlsx-roundtrip/', import.meta.url);
    const names = readdirSync(dir).filter(name => name.endsWith('.xlsx'));
    assert.equal(names.length, 13);
    for (const name of names) {
        const bytes = new Uint8Array(readFileSync(new URL(name, dir)));
        assert.ok(readWorkbook(bytes).size > 5, name);
        assert.deepEqual(compareWorkbooks(bytes, bytes), [], name);
    }
});
