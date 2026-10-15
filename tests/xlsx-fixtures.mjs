// Small XLSX workbooks built in code for the Excel view tests (no real documents in the repository).
import { strToU8, zipSync } from 'fflate';

const xml = text => strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + text);
const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const column = index => String.fromCharCode(65 + index);
function sheetXml(rows, fonts = []) {
  const body = rows.map((cells, r) => `<row r="${r + 1}">` + cells.map((value, c) => {
    const ref = `${column(c)}${r + 1}`;
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
    if (typeof value === 'object' && 'font' in value) return `<c r="${ref}" s="${2 + fonts.indexOf(value.font)}" t="inlineStr"><is><t>${escape(value.text)}</t></is></c>`;
    if (typeof value === 'object' && 'bold' in value) return `<c r="${ref}" s="1" t="inlineStr"><is><t>${escape(value.bold)}</t></is></c>`;
    if (typeof value === 'object') return `<c r="${ref}"><f>${escape(value.formula)}</f><v>${value.cached}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
  }).join('') + '</row>').join('');
  return xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`);
}

/**
 * sheets: { name: rows } where a cell is a number, a string, { formula, cached }, { bold: text } or
 * { font, text } (`font` one of `fonts`, each a cell format of its own after the two standard ones).
 */
export function makeXlsx(sheets, fonts = []) {
  const names = Object.keys(sheets);
  const files = {
    '[Content_Types].xml': xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': xml(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, i) => `<sheet name="${escape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    // The minimal stylesheet: without one, opening reports "no styles part".
    'xl/styles.xml': xml(`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${2 + fonts.length}"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font>${fonts.map(f => `<font><sz val="11"/><name val="${escape(f)}"/></font>`).join('')}</fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${2 + fonts.length}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>${fonts.map((_, i) => `<xf numFmtId="0" fontId="${2 + i}" fillId="0" borderId="0" xfId="0" applyFont="1"/>`).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
  };
  names.forEach((name, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheets[name], fonts); });
  return zipSync(files);
}

/** Two Korean sheets: values, a SUM formula (cached 3600) and a note sheet. */
export const koreanWorkbook = () => makeXlsx({
  '매출': [['품목', '금액'], ['사과', 1200], ['배', 2400], ['합계', { formula: 'SUM(B2:B3)', cached: 3600 }]],
  '메모': [['메모'], ['한국어 셀 표시 확인']],
});
/** Bold Korean next to regular Korean, for the bold-face check. */
export const boldWorkbook = () => makeXlsx({ '굵게': [[{ bold: '굵은 한국어 제목' }, '보통 한국어'], [{ bold: '합계 금액' }, 3600]] });
/** The same Latin text in Pretendard (bundled, B2) and in Arial (not in the web build). */
export const fontWorkbook = () => makeXlsx({ '글꼴': [[{ font: 'Pretendard', text: 'Hamburgefonts 0123' }], [{ font: 'Arial', text: 'Hamburgefonts 0123' }]] }, ['Pretendard', 'Arial']);
export const otherWorkbook = () => makeXlsx({ '두번째': [['다른 파일'], [42]] });
/** A ZIP cut off partway: the package cannot be read. (Bytes that are not a ZIP at all would open as text.) */
export const brokenWorkbook = () => koreanWorkbook().slice(0, 300);
