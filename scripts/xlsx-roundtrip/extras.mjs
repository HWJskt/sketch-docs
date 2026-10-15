// The parts openpyxl cannot write (without Pillow) added to its 01-values.xlsx: a picture, a custom XML
// part, custom document properties and a VBA project inside an .xlsx. Run after fixtures.py:
// node scripts/xlsx-roundtrip/extras.mjs <dir>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const dir = process.argv[2];
const base = () => unzipSync(new Uint8Array(readFileSync(join(dir, '01-values.xlsx'))));
const text = (files, name) => strFromU8(files[name]);
const edit = (files, name, change) => { files[name] = strToU8(change(text(files, name))); };
const decl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const addType = (files, part, type) => edit(files, '[Content_Types].xml', t => t.replace('</Types>', `<Override PartName="/${part}" ContentType="${type}"/></Types>`));
const addRel = (files, relsPart, id, type, target) => {
    if (!files[relsPart]) files[relsPart] = strToU8(`${decl}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);
    edit(files, relsPart, t => t.replace('</Relationships>', `<Relationship Id="${id}" Type="${type}" Target="${target}"/></Relationships>`));
};
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
// A 2×2 PNG (red, green / blue, white), written out byte by byte so the picture's bytes are fixed.
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANAAH0wOcQAAAAAElFTkSuQmCC', 'base64'));

{
    const files = base();
    files['xl/media/image1.png'] = png;
    edit(files, '[Content_Types].xml', t => t.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>'));
    files['xl/drawings/drawing1.xml'] = strToU8(`${decl}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R}"><xdr:oneCellAnchor><xdr:from><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="952500" cy="952500"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="그림 1" descr="네 칸 그림"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`);
    addType(files, 'xl/drawings/drawing1.xml', 'application/vnd.openxmlformats-officedocument.drawing+xml');
    addRel(files, 'xl/drawings/_rels/drawing1.xml.rels', 'rId1', `${R}/image`, '../media/image1.png');
    addRel(files, 'xl/worksheets/_rels/sheet1.xml.rels', 'rIdD1', `${R}/drawing`, '../drawings/drawing1.xml');
    // 01-values' sheet ends with pageMargins (no tableParts or extLst), so the drawing goes last.
    edit(files, 'xl/worksheets/sheet1.xml', t => {
        if (/<tableParts|<extLst|<drawing /.test(t)) throw new Error('01-values.xlsx changed shape; place the drawing by the schema order');
        const withNs = /xmlns:r=/.test(t) ? t : t.replace('<worksheet ', `<worksheet xmlns:r="${R}" `);
        return withNs.replace('</worksheet>', '<drawing r:id="rIdD1"/></worksheet>');
    });
    writeFileSync(join(dir, '10-picture.xlsx'), zipSync(files));
}
{
    const files = base();
    files['customXml/item1.xml'] = strToU8(`${decl}<명세 xmlns="urn:sketch-docs:fixture"><항목>보존 확인</항목></명세>`);
    addType(files, 'customXml/item1.xml', 'application/xml');
    addRel(files, 'xl/_rels/workbook.xml.rels', 'rIdC1', `${R}/customXml`, '../customXml/item1.xml');
    files['docProps/custom.xml'] = strToU8(`${decl}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="문서번호"><vt:lpwstr>SD-001</vt:lpwstr></property></Properties>`);
    addType(files, 'docProps/custom.xml', 'application/vnd.openxmlformats-officedocument.custom-properties+xml');
    addRel(files, '_rels/.rels', 'rIdP9', `${R}/custom-properties`, 'docProps/custom.xml');
    writeFileSync(join(dir, '11-custom-parts.xlsx'), zipSync(files));
}
{
    const files = base();
    files['xl/vbaProject.bin'] = Uint8Array.from({ length: 512 }, (_, i) => i % 251);
    addType(files, 'xl/vbaProject.bin', 'application/vnd.ms-office.vbaProject');
    addRel(files, 'xl/_rels/workbook.xml.rels', 'rIdV1', 'http://schemas.microsoft.com/office/2006/relationships/vbaProject', 'vbaProject.bin');
    writeFileSync(join(dir, '12-vba-in-xlsx.xlsx'), zipSync(files));
}
console.log('extras written to', dir);
