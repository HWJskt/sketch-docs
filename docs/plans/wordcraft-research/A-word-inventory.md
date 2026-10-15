# Sketch Docs: Word feature inventory (baseline for "no feature loss")

Snapshot date: 2026-10-15. Upstream EdenText commit 4c4c94cb (source/edentext). Overlays: overlays/edentext/*, applied by scripts/build-engines.mjs:50-115.

## How to read this

**Path prefixes.** All paths are relative to the product repo root.
- `S/` = `source/edentext/src/`
- `C/` = `source/edentext/src/lib/components/`
- `R/` = `source/edentext/src/lib/components/ribbon/`
- `P:` = `overlays/edentext/product.patch` (patch-file line numbers)
- `B:` = `scripts/build-engines.mjs`
- `U:` = `overlays/edentext/product-ui.mjs`
- `SB:` = `overlays/edentext/shell-bridge.txt`

**Upstream line numbers are pre-patch.** They are lines in the upstream clone. The patched copy in `.cache/build/word` is shifted slightly.

**Status tags:**
- **[product]**: added or changed by our overlays.
- **[hidden]**: present upstream but hidden or removed in the product, with evidence.
- **[unreachable]**: code exists, but in the product the user cannot reach it.
- **[DEV]**: development builds only, so absent in the deployed product.
- No tag: the upstream feature is live in the product.

**How this was built.** By reading code with four parallel read-only sub-searches plus direct reads of the overlays and shell. No feature was exercised in a browser for this inventory (see section 30).

---

## 0. How the product runs Word (context for everything below)

**Hosting**
- Word runs only as an iframe `./engines/word/index.html` inside the product shell: src/EditorShell.svelte:137.
- Opening the engine URL directly in the top window redirects to `../../word.html`, and App is not mounted: B:103-106.
- The Word engine does not register a service worker: B:101 replaces `if (import.meta.env.PROD && 'serviceWorker' in navigator)` with `if (false && ...)`.
  - Offline support comes from the product worker instead: public/sw.js; src/offline.ts.
- Removed from the engine's index.html at build time:
  - the upstream static intro markup: B:94-97;
  - GoatCounter analytics: B:98. Upstream reference: source/edentext/index.html:30.

**Chrome mode**
- Ribbon is the default. `edentext-chrome` is read at S/lib/storage/theme.ts:41-45.
- The Settings switch to "modern" is **[DEV] only**: C/SettingsDialog.svelte:152-164.
  - So deployed users get the ribbon unless localStorage already holds `edentext-chrome=modern`.
  - The modern chrome is listed in section 4 for completeness.

**Files Word cannot open in the product**
- Word itself never opens HWP/HWPX in the product. A .hwp/.hwpx goes to the shell's Hangul engine (section 1.4).

---

## 1. File open / save / formats

### 1.1 Formats and code paths

| Operation | Formats | Code | Evidence |
|---|---|---|---|
| Open (picker) | .odt .ott .docx .dotx (+ .hwp .hwpx routed away **[product]**) | `handleOpen` → `openOdt()` (File System Access picker) → `applyImport` | S/App.svelte:1181-1196; S/lib/export/saveFile.ts:28-34,113-120; P:821 |
| Open (fallback without FS Access) | same | hidden `<input type=file>` → `handleImportFile` | S/App.svelte:1198-1204,1915-1920; accept list P:202 |
| Import decision | extension decides DOCX or ODT; on failure the other importer is tried | `applyImport` | S/App.svelte:969-1115, 982, 994-1001 |
| Encrypted open | password prompt loop, then decrypt | `isProtected`, `unprotect`, `decryptPackage` | S/App.svelte:951-967,974-978; S/lib/crypto/protect.ts:19,63-73 |
| Save | to the bound handle in its own format; asks when the file changed elsewhere; falls back to Save As if the handle is lost | `handleSave` → `buildBytes` → `saveDocument` | S/App.svelte:1225-1258,1216-1223; saveFile.ts:75-111 |
| Save of a new (unbound) document | **[product]** goes straight to Save As .docx | — | P:85-89 |
| Save As | .odt, .docx | `handleSaveAs(kind)` | S/App.svelte:1262-1280; R/Ribbon.svelte:382-386 |
| Save as template | .dotx for a docx document, otherwise .ott; never bound as the file | `handleSaveTemplate`, `odtToOtt` / `docxToDotx` | S/App.svelte:1284-1299; S/lib/export/template.ts:13-35 |
| Download fallback (no FS Access: Firefox/Safari) | blob download, plus a one-time hint (`edentext-download-hint`) | — | saveFile.ts:8,49-67,91-94 |
| Raster PDF | download via jsPDF + html2canvas | `handleExportPdf` → `exportPdf` | S/App.svelte:1332; S/lib/export/pdf.ts:514 |
| Print (raster) | browser print dialog | `handlePrint` → `printRaster` | S/App.svelte:1364; pdf.ts:566 |
| Vector PDF | browser print of generated HTML | `handlePrintPdf` → `printPdf` | S/App.svelte:1395; pdf.ts:807 |

**Unsupported or not reachable**
- OS launch through `launchQueue` / manifest `file_handlers` (.odt .ott .docx .dotx) exists upstream: S/App.svelte:1167-1179; source/edentext/public/manifest.webmanifest:19.
  - **[unreachable]**: the engine is an iframe, and the product pages (word.html) link no manifest (word.html, full file).
- Drag-and-drop *file open* is not implemented. The only file drop is in the AI pane: C/AiPane.svelte:313.
  - Image drag-and-drop into the document does exist: C/Editor.svelte:1315-1322.

**What a successful import adopts**
- Embedded fonts: S/App.svelte:1020-1024.
- Page format, margins, decor, language, styles, notes, document properties: S/App.svelte:1037-1063.
- Headers and footers, the file handle, and the format: S/App.svelte:1078-1088.
- A missing-font warning: S/App.svelte:1093-1109.
- A structure-repair warning: S/App.svelte:1002-1010; S/lib/import/repairContent.ts:8-20.

**Import safety limits**
- ZIP and XML limits: 128 MiB compressed, 10,000 entries, ratio 1000:1. XML entities are rejected.
- Evidence: S/lib/import/importLimits.ts:35; S/lib/import/CLAUDE.md:6-11.

### 1.2 DOCX import (S/lib/import/docx.ts, docxStyles.ts)

**Imported**
- Package parts: document, styles, numbering, theme: docx.ts:266-273.
- Styles become named styles, with direct-formatting deltas: docx.ts:276-279,1244-1301.
- Theme fonts and colours: docx.ts:1955,2647,2700.
- Document language: docx.ts:473.
- Core properties: docx.ts:4002-4020.
- Embedded .odttf fonts: docx.ts:432-457.
- Settings: autoHyphenation, trackRevisions, mirrorMargins, evenAndOddHeaders, defaultTabStop, note settings, compatibility flags: docx.ts:396-407,3811-3898.
- Run properties: bold, italic, underline styles and colour, strike, double strike, super/subscript, colour, size, spacing, kerning, west and East Asian fonts, highlight and shading, caps and small caps, position, emphasis marks, language: docxStyles.ts:27-48,120-169; docx.ts:2398-2463.
- Paragraph properties:
  - alignment, spacing, line spacing, indents in cm and in characters: docx.ts:1684-1738;
  - page break before, keep with next, keep lines together, widow control: docx.ts:1517-1528,1742;
  - snap to grid, bidi, no-hyphenation, tab stops: docx.ts:1543-1550,1716;
  - borders and shading, contextual spacing, outline level: docx.ts:1606-1680,1754-1789.
- Lists and numbering, including Russian and CJK formats; outline numbering; list styles: docx.ts:807-1075,1327,1427.
- Tables:
  - grid widths, gridBefore/After, vMerge/gridSpan, vertical alignment, shading, padding, borders;
  - header row, cantSplit, table styles with tblLook, floating tables, cell formulas;
  - evidence: docx.ts:3135-3590,544.
- Pictures:
  - svgBlip preferred; size, alt text, rotation, crop; anchored wrap and z-order: docx.ts:2491-2576,2744-2840;
  - groups are split into separate frames: docx.ts:2583-2641.
- DrawingML shapes and text boxes (preset and custom geometry, fill/stroke, arrows, flip, vertical text): docx.ts:2864-3045.
- VML shapes with text: docx.ts:3046-3130.
- Charts → static SVG (bar, line, pie, area, scatter; 3D variants): S/lib/import/chart.ts:1-3,81-83.
- Sections:
  - section breaks (continuous, odd, even): docx.ts:299-345,3598-3630,3741-3753;
  - paper size and orientation, margins, mirror: docx.ts:4023,4077,361;
  - columns: docx.ts:3756-3797;
  - page numbering: docx.ts:3915;
  - line numbering: docx.ts:3719-3730;
  - line grid: docx.ts:3707-3715;
  - RTL section: docx.ts:3734.
- Headers and footers per section (default, first, even), with live PAGE, NUMPAGES and STYLEREF: docx.ts:359-418,2212-2220.
- Page decor:
  - background: docx.ts:3638;
  - page border, top side only: docx.ts:3639-3650;
  - VML watermark: docx.ts:3678-3702;
  - fold marks: docx.ts:3656.
- Footnotes and endnotes, including custom marks: docx.ts:170,2091-2105,1839,351-357.
- Comments with resolved state and threads: docx.ts:3943-4000,689-711.
- Tracked insertions and deletions: docx.ts:1973-1991,2186-2188.
- Fields:
  - TOC, INDEX, BIBLIOGRAPHY: docx.ts:755-791,869-891;
  - PAGEREF, NOTEREF, REF: docx.ts:2302-2337;
  - SEQ: docx.ts:2341-2361;
  - DATE and TIME: docx.ts:2363-2375;
  - CITATION with customXml sources: docx.ts:2222-2287;
  - XE: docx.ts:2289-2300;
  - any other field keeps its shown result: docx.ts:2183.
- Bookmarks: docx.ts:663-718.
- Hyperlinks, with unsafe schemes blocked: docx.ts:2136-2148.
- Ruby: docx.ts:2074-2080.
- Placeholder content controls: docx.ts:2123-2134.
- OMML equations → LaTeX: docx.ts:2111-2118,2198-2207.

**Lossy on import (preserve or improve, do not regress)**
- More than 3 columns → 3: docx.ts:3756-3774.
- Nested tables are flattened: docx.ts:865-868.
- Nested text boxes are flattened: docx.ts:3042.
- Negative crop is not kept: docx.ts:2559.
- Complex-script run properties are not read: S/lib/import/CLAUDE.md:35-36.
- Character grid is not modelled: docx.ts:3707-3715.
- Inferred from missing handlers:
  - `w:vanish` hidden text imports as visible;
  - moveFrom/moveTo and pPrChange/rPrChange are dropped;
  - OLE `w:object` is not converted;
  - form fields keep only their text.

### 1.3 ODT import (S/lib/import/odt.ts, styleResolver.ts)

**Imported**
- Package: content.xml and styles.xml: odt.ts:1049-1061.
- Named and automatic styles: styleResolver.ts:202-300.
- Meta properties: odt.ts:1324.
- Embedded fonts: odt.ts:1100-1104.
- Language: odt.ts:1113-1126.
- Hyphenation: styleResolver.ts:444.
- Spacing model: odt.ts:1030-1047.
- Tab interval: styleResolver.ts:470.
- Paragraph and per-script text properties: odt.ts:1807-1839,2206-2316,2982-3070.
- Lists, list styles, outline numbering: odt.ts:3160-3355,1953-2050.
- Tables, including cell number formats: odt.ts:3454-3604,3378.
- Frames:
  - images, picking a browser-displayable alternative; crop: odt.ts:466-502;
  - text boxes: odt.ts:597;
  - shapes, freeform, lines, groups: odt.ts:707-881;
  - formula objects (MathML or LaTeX annotation): odt.ts:629-700;
  - charts → SVG: odt.ts:651-670.
- Sections, columns, master pages: odt.ts:1086-1092,1191; styleResolver.ts:620-760.
- Headers and footers (default, first, left/even) with page, count and chapter fields: odt.ts:1128-1180,2729-2745.
- Page geometry, decor, line numbering, line grid, page numbering, fold marks: styleResolver.ts:902,959,1001,450; odt.ts:1292,947.
- Footnotes, endnotes and their settings: odt.ts:2506,2633; styleResolver.ts:655.
- Comments with replies: odt.ts:2845-2912.
- Tracked changes: odt.ts:2414-2441,2692-2726.
- Fields:
  - date/time, placeholder, sequence: odt.ts:2396,2749,2764,2455,2776;
  - index marks, bibliography marks: odt.ts:2800-2810;
  - bookmarks and references: odt.ts:2643-2690;
  - other fields keep their evaluated text: odt.ts:2818-2821.
- LibreOffice content controls: odt.ts:2824-2838.
- Indexes (TOC, illustrations, tables, alphabetical, bibliography) become live nodes: odt.ts:1484-1487.
- Links, ruby, breaks, tabs: odt.ts:2602-2626.

**Lossy on import**
- Hidden paragraphs are removed, with a warning: odt.ts:1385-1392.
- Nested tables are flattened: odt.ts:1457,3197.
- More than 3 columns → 3: odt.ts:1353-1357.
- Connectors and unsupported shapes are dropped: odt.ts:706-897.
- OLE objects other than formulas and charts are dropped: odt.ts:964-966.
- A `draw:a` link around a drawing is dropped: odt.ts:986-988.

### 1.4 HWP/HWPX in the Word app **[product]**

**Opening**
- Upstream patch: `applyImport` sends .hwp/.hwpx to `nativeHangulFile` (HangulWorkbench): P:58-65.
- The build replaces that in hosted mode with `window.parent.sketchShell.openHangul({bytes,name,handle})`: B:73-78.
  - The shell switches to its Hangul (rhwp) editor and passes the file: src/EditorShell.svelte:111-122.
- Word is always hosted, so in practice HWP opens in the Hangul engine, not inside Word.

**Menu entry "한글 문서 열기 / 새 문서"**
- Ribbon File menu: P:459-461. Modern export menu: P:193.
- It calls `openHangul`, which in hosted mode calls `sketchShell.openHangul()`: B:67-72.

**The in-Word HangulWorkbench**
- The build regenerates it as a wrapper around src/HangulEditor.svelte with `startNew`: B:62.
- It is reached only when not hosted, which cannot happen (B:103-106). **[unreachable]**

**Save as HWP/HWPX from Word (`handleHangulSave` → tiptapToHwpx → rhwp)**
- Code: P:107-159,764-811,465-763.
- **[unreachable] in the visible UI.** Nothing sets `documentFormat` to hwp/hwpx:
  - `applyImport` routes those files away;
  - the Save As buttons are odt/docx only: R/Ribbon.svelte:382-386;
  - SaveFormatDialog, which got hwp/hwpx buttons at P:417-418, is no longer mounted: P:23,42,210.
  - The only path left is a stored `edentext-doc-format=hwp|hwpx` from earlier storage.
- Its refusal rules (record them in case the feature is expected): P:110-119,130-133,141,799-805.

**Other format changes**
- `DocumentFormat` widened to include hwp/hwpx, and persisted: P:946-962.
- New documents default to docx (upstream: odt): P:50-51.

### 1.5 Images and fonts on import
- Native image formats: png, apng, jpg, gif, bmp, svg, webp, avif, ico: S/lib/import/imageFormats.ts:7-48.
- Converted formats:
  - TIFF → PNG via utif2, first frame only: imageFormats.ts:250-262;
  - EMF → SVG via a custom renderer: imageFormats.ts:263-265; S/lib/import/emf.ts:1-3.
- WMF, SVM, EPS and PICT become a placeholder or are dropped, with a warning: imageFormats.ts:1-3,293.
- CMYK ICC profiles are stripped: imageFormats.ts:133-134.
- Missing-font detection uses a canvas probe and Local Font Access: S/lib/utils/fontDetect.ts:4-181.

### 1.6 Export detail

**DOCX** (S/lib/export/docx.ts, npm `docx` plus post-processing passes)
- Pipeline: docx.ts:3336,3607-3636.
- Properties and settings: docx.ts:3538-3552.
- Compatibility flags: docx.ts:3628-3631.
- Styles, numbering, outline numbering: docx.ts:3296,1718,1754.
- Runs and underline styles: docx.ts:552-620,539.
- Paragraphs: docx.ts:2521-2640.
- Tables, including formula fields: docx.ts:2766-2860,933-943.
- Images: PNG, JPEG, GIF and BMP are kept; SVG is rasterised to PNG: docx.ts:958-966,1068-1077.
  - Inferred: WEBP, AVIF and ICO are dropped.
- Shapes as DrawingML: docx.ts:1103-1610.
- Headers and footers per section: docx.ts:3485-3530.
- Section types, columns, page numbering, line numbers, line grid, mirror: docx.ts:3464-3598,2101.
- Page decor and fold marks: docx.ts:2197,2311,2256.
- Notes: docx.ts:3380-3409.
- Comments with replies: docx.ts:3557-3564,843-858.
- Tracked changes: docx.ts:630-650.
- Bookmarks and links: docx.ts:823-870.
- Fields:
  - PAGE, NUMPAGES, STYLEREF: docx.ts:892-900;
  - DATE/TIME, SEQ: docx.ts:681-768;
  - REF, PAGEREF, NOTEREF: docx.ts:770-808;
  - XE, CITATION: docx.ts:913-932;
  - TOC: docx.ts:2863.
- OMML equations: docx.ts:944-949,1874.
- Ruby and placeholders: docx.ts:1899,1928.
- Embedded fonts: docx.ts:2147,3632.

**ODT** (S/lib/export/odt.ts, odf-kit plus marker passes; ODF 1.3)
- Pipeline and package: odt.ts:5453,5492,5643-5774.
- Lists and tables: odt.ts:5643-5704,4160,4310.
- Images with wrap, crop, rotation: odt.ts:528-570,4577.
- Formulas as MathML with a LaTeX annotation: odt.ts:4699-4752.
- Fields: odt.ts:4783,4816,816,862,905.
- Ruby: odt.ts:946.
- Tracked changes: odt.ts:721.
- Comments: odt.ts:5268.
- Bookmarks and cross-references: odt.ts:5199-5266.
- Shapes: odt.ts:4962.
- Columns: odt.ts:5011.
- Notes: odt.ts:5328,5055.
- Indexes: odt.ts:5390.
- styles.xml rewrite: odt.ts:3468,5727.
- Master pages: odt.ts:5733-5738,6042.
- Watermark and fold marks: odt.ts:3334,3409.
- Embedded fonts: odt.ts:4647.
- Properties: odt.ts:5834.

**PDF modes** (S/lib/export/pdf.ts)

1. **Raster PDF download**
   - html2canvas strips → JPEG at 2× → jsPDF, with an invisible text layer and appended comment pages: pdf.ts:257-550.
   - Inferred: no tagging or metadata; the invisible layer uses jsPDF's default font, so CJK search may not work.
2. **Raster print**
   - A hidden iframe with `@page` sizing, then `window.print()`: pdf.ts:577-610.
3. **Vector print**
   - generateHTML is printed natively; headers and footers become CSS `@page` boxes as text only: pdf.ts:617-640,719-721,783-789.
   - Only the first section's header/footer set is passed: S/App.svelte:1400-1417.

**Review markup in print** (change bars and a comment list): S/lib/export/reviewPrint.ts:1-40. Toggled from Review ▸ Print markup (section 11).

---

## 2. Templates
- **Template gallery.** Built-in templates, no network: S/lib/templates/registry.ts:11.
  - Offered: DIN 5008 B, DIN 5008 A, Private letter, US letter.
  - Shelved: cover letter, CV, invoice, minutes: registry.ts:14.
  - A template can set content, format, margins, styles and fold marks: S/lib/templates/types.ts:8-23.
  - Applied by `applyTemplate`: S/App.svelte:883-903.
  - Dialog: C/TemplateGalleryDialog.svelte:35-69.
  - Opened from File ▸ New from template: R/Ribbon.svelte:367.
- **Korean UI only partly translates this area.** The dialog title is translated, but the sample templates keep English: overlays/edentext/ko.ts:3,14.
- **Opening .ott / .dotx** loads the content without binding the file: S/App.svelte:985,1078-1088.
- **Saving as template**: section 1.1.

## 3. Encryption / password protection
- **Detection and routing**: S/lib/crypto/protect.ts:13-73.
- **ODF**
  - Write: AES-256-GCM `encrypted-package` with Argon2id (t=3, m=64 MiB, p=4): S/lib/crypto/odf.ts:1-3,24-25,215-231.
  - Read: the same, plus legacy per-entry AES-CBC/GCM with PBKDF2-SHA1: odf.ts:15-19,88-144.
  - Blowfish is rejected: odf.ts:88-91.
- **OOXML** (MS-OFFCRYPTO)
  - Write: Agile, AES-256-CBC, SHA-512, spinCount 100k, HMAC integrity, inside a CFB container: S/lib/crypto/ooxml.ts:1-3,18,28-31,185-221; S/lib/crypto/cfb.ts:40.
  - Read: Agile (SHA-1/256/384/512) and Standard AES-ECB: ooxml.ts:35,110-146,229-261.
  - RC4 is not supported.
- **UI**
  - File ▸ Protect with password: R/Ribbon.svelte:417-420.
  - PasswordDialog set and ask modes: C/PasswordDialog.svelte:4-13,23-24,116-120.
  - The password lives in session memory only; only the `edentext-doc-protected` flag persists: S/App.svelte:262-271,938-948.
  - The autosaved copy is unencrypted, and protected documents are always pruned: S/lib/storage/docScope.ts:166-170.

## 4. Chrome: ribbon (default) and modern

### 4.1 Ribbon shell (R/Ribbon.svelte)

**Tabs**
- Fixed tabs: File, Home, Insert, Layout, References, Review, View: R/commands.ts:4.
- Contextual tabs: Table Design, Table Layout, Picture Format, Shape Format, Header & Footer: R/commands.ts:5. Visibility rules: R/Ribbon.svelte:171-207.
- The ribbon always starts on Home: R/Ribbon.svelte:167.

**File menu** (R/Ribbon.svelte:352-428)
- New: :364
- New from template: :367
- Open (Ctrl+O): :370
- Browser documents: :374
- **[product]** "한글 문서 열기 / 새 문서": P:459-461
- Save (Ctrl+S): :378
- Save as .odt: :382
- Save as .docx: :385
- Raster PDF: :389
- Vector PDF: :393
- Save as template: :397
- Recent files list and Clear recent: :401-410
- Print (Ctrl+P): :413
- Protect with password: :417
- Document properties: :421
- **[hidden]** About: :424-426, removed by U:43 (`data-cmd="about"` button deleted).
  - The upstream About dialog is reached instead from the shell's ⓘ dialog, via the "EdenText 정보" button: src/AboutProduct.svelte:40; src/EditorShell.svelte:176; SB:13.

**Quick-access bar**: Save, Undo split, Redo split: R/Ribbon.svelte:431-435; C/HistoryButton.svelte:75-110 (history dropdown, jump to step i).

**Header strip**
- Command search (Alt+Q): R/Ribbon.svelte:452; R/CommandSearch.svelte:34,74; index at R/commands.ts:25-216.
- Document name: upstream it is an editable input (R/Ribbon.svelte:454-467).
  - **[hidden]** In the product it is a read-only label, so renaming is removed: U:11-39 applied at U:41.
  - After a save, the name follows the saved file name: U:46-60.
- Unsaved-changes marker: R/Ribbon.svelte:470.
- Collapse/expand the ribbon (persisted): R/Ribbon.svelte:474-483.
- **[hidden]** Appearance (theme) menu: R/Ribbon.svelte:485-506. Hidden by CSS when hosted (U:42-46; `sketch-hosted` class set at SB:16). Still available in Settings ▸ General.
- Settings gear: R/Ribbon.svelte:508-510.
- **[hidden]** UI language picker: R/Ribbon.svelte:512 (`.lang-wrap`). Hidden by U:44. Still available in Settings ▸ General.
- **[hidden]** Logo/About button: R/Ribbon.svelte:514-516 (`.rb-logo-btn`). Hidden by U:44.

**AI group** (Chat, toggles the AI pane), shown only when AI is enabled: R/Ribbon.svelte:555-562.

**Dialogs hosted by the ribbon**: Link, Bookmark, Cross-reference, Formula, Paragraph, Tabs: R/Ribbon.svelte:566-571.

### 4.2 Modern chrome (reachable only with a pre-set `edentext-chrome=modern`; S/App.svelte:1638-1911)

**Header**
- **[not hidden by product]** Logo → upstream About: S/App.svelte:1643.
- Document name, made read-only in the product: U:41-56.
- New, from template, Open, Save: S/App.svelte:1682-1707.
- Save/Export menu: S/App.svelte:1710-1770.
  - It contains the ODT/Save, Save as .odt, Save as .docx, raster PDF, vector PDF, browser documents, template, recent files, password and properties entries.
  - **[product]** It also has the "한글" entry: P:193.
- Print: S/App.svelte:1773.
- Appearance menu: theme, AutoCorrect, AutoText, Thesaurus, Settings: S/App.svelte:1782-1849.
- UI language picker: S/App.svelte:1850. Not hidden here, because U only hides it inside the ribbon.
- Tools toggle: S/App.svelte:1857-1877.

**Toolbar island** (C/Toolbar.svelte): Bold, Italic, Underline, Strike, Styles dropdown, Bullets split, Numbering split, Align, Undo/Redo: C/Toolbar.svelte:209-482.

**ToolbarExpanded** (C/ToolbarExpanded.svelte:1064-1926)
- Font, size, grow/shrink, colours, shading, borders, sup/sub, indent.
- Spacing dropdown.
- Layout dropdown: page numbers, hyphenation, size, orientation, margins, mirror, header/footer edit and options.
- Marks, ruler, split view, pages-across, navigator.
- Table, symbol, date, formula, image, text box, columns.
- TOC (contents only), footnote, endnote, note options, link, bookmark, cross-reference, clear formatting.

**Missing from the modern chrome compared with the ribbon**: listed in the ribbon agent's findings. These are covered by the ribbon, which is the product default.

## 5. Home tab (R/tabs/HomeTab.svelte)

**Clipboard**
- Paste split: Paste (HTML from the clipboard), Paste without formatting (Ctrl+Shift+V): :216-236.
- Cut and Copy via execCommand: :241-242.

**Font**
- Font family combo: Recent / Web-safe / All, plus "Load all fonts" via Local Font Access: :251; R/controls/FontFamilyBox.svelte:68-106.
- Size combo (includes named Chinese sizes under zh-Hans): :252; R/controls/FontSizeBox.svelte:61-84.
- Grow/Shrink (Ctrl+Shift+. / ,): :253-254.
- Change case: none / UPPER / lower / Capitalize / small caps: :255-264,90-101.
- Bold (heading-aware un-bold): :267,57-61.
- Italic: :268.
- Underline and Strike splits, each with 5 line styles: :269-292.
- East Asian emphasis mark split, shown only for an Asian document/UI/selection: :294-307,106-113.
- Subscript and Superscript, mutually exclusive: :308-309.
- Highlight colour split: :311-321.
- Font colour split: :322-331.
- Clear formatting (Ctrl+M): :332.
- Shared ColorPicker: last colour, palette, no colour, More colours, eyedropper ("pick from page"), notation select, hex input: C/ColorPicker.svelte:428-515.

**Paragraph** (launcher opens ParagraphDialog: R/RibbonGroup.svelte:18-24)
- Bullets split: default bullet, bullet-character grid, list styles, Manage list styles: :342-366.
- Numbering split: script-dependent formats, list styles, Manage; on a heading it switches to chapter numbering: :367-388,72-73.
- Decrease/Increase indent (list-aware): :390-391,136-142.
- Show formatting marks: :393.
- Align left / center / right / justify: :396-404.
- Line spacing 1 / 1.15 / 1.5 / 2: :405-417.
- Paragraph shading: :419-429.
- Paragraph borders: presets, width, colour: :430; C/ParagraphBorderPicker.svelte:25-137.

**Styles gallery** (R/controls/StyleGallery.svelte:78-120)
- Style tiles with shortcuts.
- More menu: all paragraph styles, Show all styles, character styles, Manage styles.

**Editing**: Find (Ctrl+F), Replace (Ctrl+H): :445-446.

## 6. Insert tab (R/tabs/InsertTab.svelte)
- Page break (Ctrl+Enter): :101-111.
- Table picker: grid, rows×cols inputs, Manage table styles: :115-125; C/TablePicker.svelte:119-163.
- Picture from a file (`accept=image/*`): :130,242-248.
- Text box: :131-139.
- Link (Ctrl+K), Bookmark, Cross-reference: :146-148.
- Header and Footer, which enter the zone: :155-156.
- Page number menu: page number and page count fields: :157-165.
- Header/footer options: different first page, different odd/even, header and footer distance: :166-194.
- AutoText (Quick Parts): :200-208.
- Ruby (phonetic guide): :209-217; C/RubyDialog.svelte.
- Date & time picker: date formats, time formats, "update automatically": :218-225; C/DateTimePicker.svelte:94-106.
  - **[product]** The Korean default date format is `ymd_slash`: P:974.
- Symbol picker: search, recent, categories: :231-238; C/SpecialCharPicker.svelte:138-173.
- Equation: :239; C/FormulaDialog.svelte.

## 7. Layout tab (R/tabs/LayoutTab.svelte)

**Page Setup**
- Margins: presets Normal / Narrow / Wide, custom values, mirror margins: :166-202.
- Orientation, with a per-section override: :204-220.
- Size: A3–A6, ISO B4–B6, JIS B4/B5, 16K, 32K, Letter, …; per-section override: :222-245; S/lib/storage/pageFormat.ts:16.
- Columns 1–3 with gap: :247-280.
- Breaks: page break, section break, section starts on any/odd/even page: :282-320.
- Hyphenation toggle: :323-331.
- Page number format 1/i/I/a/A, start-at, per-section continue/restart: :332-391.
- Line numbers: off, continuous, restart each page, interval, count empty lines: :395-431.
- Page decor dialog (background, border, watermark): :432-440; C/PageDecorDialog.svelte.
- Fold marks (A4 portrait only): :441-450.

**Paragraph**: indent left/right, spacing before/after: :460-483.

## 8. References tab (R/tabs/ReferencesTab.svelte)
- Table of contents / Figures / Tables / Alphabetical index / Bibliography: :92-113.
- TOC options: max level, page numbers on/off: :114-142.
- Update indexes, whole or pages only: :145-153; C/IndexUpdateDialog.svelte.
- Heading numbering, which opens the Style Manager outline tab: :154-162.
- Footnote (Ctrl+Alt+F), Endnote (Ctrl+Alt+D), Note options dialog: :169-197; C/NoteOptionsDialog.svelte.
  - Note options cover format, start, restart, position, prefix/suffix, styles and the separator.
- Citation dialog: :202-210; C/BibliographyDialog.svelte.
  - 10 source types and fields: overlays/edentext/ko.ts:15.
- Citation style Key / Numbered / APA / MLA / Chicago: :211-232; S/lib/utils/citationStyle.ts:11.
- Insert caption: :237-247; C/CaptionDialog.svelte.
- Mark index entry: :251-261.

## 9. Review tab (R/tabs/ReviewTab.svelte)
- Thesaurus (Ctrl+F7): :84-91.
- Word count popover: :92-116.
- AutoCorrect: :117-125.
- New comment: :161-169.
- Show comments, in balloons or a pane: :170-171,132-158.
- Previous/next comment: :173-188.
- Track changes toggle: :195-203.
- Markup display All / Simple / None / Original: :204-224.
- Show changes, in balloons or a pane: :225-226.
- Accept, Accept all, Reject, Reject all: :229-264.
- Previous/next change: :267-282.
- Print markup: :290-301.
- Proofing language (selection or all text): :305-313; C/LanguagePicker.svelte:60-88.
- Grammar toggle: C/GrammarToggle.svelte:21-33.

## 10. View tab (R/tabs/ViewTab.svelte)
- Navigator (F5): :49.
- Ruler: :51.
- Formatting marks: :52.
- Field shadings: :53.
- Split view (Ctrl+Alt+S): :55.
- Pages across 1–4: :56-76.
- Zoom out / % reset / in, range 20–300: :81-85; S/lib/utils/zoom.ts:4-5.
- **[DEV]** Debug dump: :87-92; S/App.svelte:1586.

## 11. Contextual tabs

**Header & Footer** (R/tabs/HeaderFooterTab.svelte)
- Header and Footer zones: :37-38.
- Page number, page count and chapter fields: :44-46.
- Date/time: :47-54.
- Different first page, different odd/even: :63,67.
- Header and footer distance: :78-90.
- Tabs…: :94.
- Close: :99-101.

**Table Design** (R/tabs/TableTabs.svelte:116-163)
- Table style gallery with "No style": C/TableStylePicker.svelte:72-92.
- Look options: header row, last row, first column, last column, banded rows, banded columns: C/TableStylePicker.svelte:20,115-121.
- Cell shading: :127-140.
- Borders: 10 presets, width, colour: :141-144; C/TableBorderPicker.svelte:23-138.
- Header row style, first column style, repeat header row: :149-163.

**Table Layout** (R/tabs/TableTabs.svelte:164-328)
- Delete row / column / table: :166-186.
- Insert above, below, left, right: :189-192.
- Merge cells: :199.
- Split cells N×M: :200-212.
- Cell vertical alignment: :217-227.
- Cell margins: :231-266.
- Sort, up to 3 keys: :271-286; C/TableSortDialog.svelte.
- Formula (SUM/PRODUCT/AVERAGE/MIN/MAX/COUNT/ABS/INT/SIGN/MOD/ROUND over ABOVE/BELOW/LEFT/RIGHT, with number format): :287-302; S/lib/utils/tableFormula.ts:67-87.
- Number recognition: :303-311.
- Insert caption: :318-327.

**Picture Format / Shape Format** (R/tabs/FrameTabs.svelte)
- Wrap: inline, left, right, top/bottom, behind, in front: :85-87.
- Order: forward, backward, front, back: :88-94.
- Wrap gaps: :99-117.
- Caption: :123-132.
- Alt text (picture only): :134-150.
- Shape styles (shape only):
  - shape picker with 17 kinds: :156-162; C/ShapePicker.svelte; S/lib/utils/shapes.ts:63;
  - fill, border colour, border width: :163-202.
- Vertical text and text vertical alignment (shape only): :207-226.

## 12. Floating toolbars, context menu, status bar, panes

**Table toolbar** (C/TableToolbar.svelte:89-314)
- Row and column insert/delete, delete table.
- Merge, split, sort, formula, number recognition.
- Vertical alignment, shading, borders, table style, header row, first column.

**Image toolbar**: six wrap modes: C/ImageToolbar.svelte:30,50-105.

**Text box toolbar** (C/TextBoxToolbar.svelte:45-243)
- Six wrap modes.
- Box alignment (top/bottom wrap only).
- Vertical text, shape, fill, border colour, border width.

**Context menu** (S/lib/editor/contextMenuItems.ts:68-183; C/ContextMenu.svelte)
- Spelling suggestions, Ignore all, Add to dictionary.
- Grammar message, suggestions, Ignore.
- Cut, Copy, Paste, Paste without formatting.
- AI submenu: Rephrase, Shorten, Formal, Fix, Translate, Rewrite…, Draft… (Alt+I), Open chat.
- Insert/Edit link, Copy link, Remove link.
- Insert bookmark, New comment, Insert cross-reference, Thesaurus, Clear formatting.
- Shift+right-click falls through to the browser menu.

**Status bar** (S/App.svelte:1987-2047)
- Page X of Y.
- Word count button and statistics popover: words, characters with and without spaces, paragraphs, pages, for the selection and the document.
- Proofing language select.
- Grammar toggle.
- Busy indicator: C/BusyIndicator.svelte:55-66.
- Zoom −, slider, +, % reset.

**Panes**
- NavigatorPane: headings with jump, move up/down, promote/demote; tables, images and bookmarks as jump targets: C/NavigatorPane.svelte:61-95; S/lib/editor/extensions/outline.ts:145-171.
- CommentsPane, RevisionsPane, ConnectorLayer: S/App.svelte:1972-1977.
- CommentCard: reply, edit, resolve, remove: C/CommentCard.svelte.
- RevisionCard: accept/reject: C/RevisionCard.svelte.
- ReviewMarginLayer balloons: C/ReviewMarginLayer.svelte.
- ChangeBarLayer: C/ChangeBarLayer.svelte.
- AiPane: section 17.
- ResumeCard, showing the 3 recent browser documents while the page is empty: C/ResumeCard.svelte:9-25; S/App.svelte:2068.

**Ruler**: indents and tab stops by drag: C/Ruler.svelte.

**Page layers**: page sheets, page decor/watermark, fold marks, line numbers, headers/footers: C/PageSheetLayer.svelte, PageDecorLayer.svelte, FoldMarkLayer.svelte, LineNumberLayer.svelte, HeaderFooterLayer.svelte.

## 13. Document model (character, paragraph, styles, lists, tabs)

All editor extensions are registered in S/lib/editor/extensions.ts:106-329. Extension files below are in S/lib/editor/extensions/.

**Character formatting**
- Bold, italic: extensions.ts:109-112.
- Sub/superscript: :124-125.
- Font size (pasted px converted to pt): :130-135.
- Multicolour highlight: :143.
- Text effects: caps variants, raised/lowered position, emphasis marks, underline/strike line style and colour: textEffects.ts:10-60.
- Western and Asian font families: fontFamily.ts:7.
- Font weight: fontWeight.ts:15.
- Font colour: fontColor.ts:15.
- Character style mark: characterStyle.ts:16.
- Link with bookmark jumps: link.ts:28,47.
- Per-run and per-paragraph language: language.ts:48-69.
- Ruby: ruby.ts:16,52.
- No-break space and soft hyphen by shortcut (section 26).

**Paragraph formatting**
- Paragraph style and clear direct formatting: paragraphStyle.ts:30-89.
- Line height as a factor or fixed pt: lineHeight.ts:17,62.
- Space before/after: paragraphSpacing.ts:22,69-74.
- Paragraph-mark font size: blockFontSize.ts:16,78.
- Indents in cm and in characters: indent.ts:145-360.
- Tab stops (left, center, right, decimal, with leaders): tabStops.ts:14-15,455,481; dialog C/TabsDialog.svelte.
- Paragraph background and borders: paragraphBox.ts:43-66.
- RTL/LTR per block: textDirection.ts:17,47.
- Page break before, keep with next, keep together, section break: pageBreak.ts:20-171.
- Alignment, including inside frames: extensions.ts:281-284.
- ParagraphDialog: indents and spacing, text flow, direction: C/ParagraphDialog.svelte.

**Document-level settings**
- Default tab interval: S/lib/storage/tabInterval.ts:7.
- Spacing model: S/lib/storage/spacingModel.ts:8,23.
- Half-width space balancing: S/lib/storage/balanceSpaces.ts:7.
- Line grid: S/lib/storage/lineGrid.ts:10.
- Page RTL: S/lib/storage/writingMode.ts:9.
- Hyphenation (CSS `hyphens:auto`): S/lib/storage/hyphenation.ts:10; C/Editor.svelte:1828.

**Styles** (S/lib/styles/*; C/StyleManagerDialog.svelte)
- Families: paragraph, character, table, list, plus outline: styleSheet.ts:22-126.
- Built-in paragraph styles: Title, Subtitle, Quotations, Caption: styleSheet.ts:105-113.
- Built-in character styles: Emphasis, Strong Emphasis, Source Text: styleSheet.ts:119-121.
- Headings 1–10 with LibreOffice sizes: headings.ts:4-26.
- Inheritance and new-style-from-selection: styleSheet.ts:222,438,495,537.
- Per-document store with rename, delete, reset: sheet.svelte.ts:11-149.
- Style Manager with five tabs and live apply: StyleManagerDialog.svelte:34-35,484-488.

**Lists**
- Bullet character: bulletList.ts:8,20.
- Ordered types and chapter numbering: orderedList.ts:11,99.
- Named list styles: listStyle.ts:145,152.
- Marker follows the formatting of the first run: listMarker.ts:192.
- Built-in list styles: Outline I.A.1, Outline A.I.1, Numbering 1.a.i, Numbering with bullets, Diamond bullets, Checklist: S/lib/styles/listStyles.ts:28,118-149.
- Outline numbering up to 10 levels: S/lib/styles/outlineNumbering.ts:11-137.
- Script-dependent number formats (CJK, Cyrillic): S/lib/utils/orderedListTypes.ts.

**Drop caps**: not implemented. No extension exists, so there is nothing to preserve.

## 14. Tables (model)

Extension files are in S/lib/editor/extensions/.
- Cell content restricted: no nested tables, no tables inside list items: extensions.ts:97-98,233-251.
- Column and row inserts copy the source formatting: tableInsert.ts:7.
- Row height and can't-split: tableRow.ts:11,28.
- Column and row resize by drag: tableColumnResize.ts:391; tableRowResize.ts:187.
- Split cells: tableSplit.ts:218.
- Formulas: tableFormula.ts:22,137,221-231.
- Sort: tableSort.ts:16,104.
- Cell background: tableCellBackground.ts:8.
- Cell vertical alignment: tableCellAlign.ts:10.
- Cell borders: tableCellBorders.ts:211,245.
- Cell padding: tableCellPadding.ts:45.
- Header row and header column: tableHeaderRow.ts:110-125.
- Table styles and look: tableStyle.ts:142,186-201.
- 10 built-in table styles: S/lib/styles/tableStyles.ts:100-178.
- Number recognition setting: S/lib/storage/tableOptions.svelte.ts:10.

## 15. Images, shapes, text boxes, equations

**Images**: inline or floating, six wrap modes, offsets, wrap distance, crop, rotation, z-order, page/body anchoring: S/lib/editor/extensions/image.ts:13-28,410-519.
- Ways to insert: picture button, paste (only when the clipboard has no text), drag-drop: C/Editor.svelte:1315-1333.
- Remote images are dropped on paste: S/lib/editor/paste.ts:8-10.

**Text boxes and shapes**: 17 shape kinds, presets/paths, arrowheads, flip, vertical text, fill/stroke, padding, wrap: S/lib/editor/extensions/textBox.ts:84-363; S/lib/utils/shapes.ts:63.
- Arrow keys leave the box at its edge: textBox.ts:502-514.

**Charts**: imported as static SVG pictures only. There is no chart editing: S/lib/import/chart.ts:1-3.

**Equations**
- Formula node stores LaTeX and a display flag: S/lib/editor/extensions/formula.ts:7-84.
- LaTeX parser and writer: S/lib/math/latex.ts.
- MathML rendering and import: S/lib/math/mathml.ts.
- OMML for DOCX: S/lib/math/omml.ts.
- FormulaDialog: live preview, LaTeX source, palettes (structures, operators, relations, greek), inline/display toggle: C/FormulaDialog.svelte:34-146.
- Double-clicking a formula opens it for editing.
- STIX Two Math font: S/styles/global.css:110-119.

## 16. Page setup, sections, columns, headers/footers, page numbers, notes

**Columns**
- Columns 1–3 with gap; Enter on an empty line breaks out: S/lib/editor/extensions/columns.ts:22-236.
- Columns flow across pages: columnsFlow.ts:166.

**Pagination**: pagination engine with footnotes placed at the foot of their page: S/lib/editor/extensions/pageBreaks.ts:745.

**Sections**: extra header/footer sections and per-section orientation, size and page numbering: S/lib/storage/headerFooter.ts:13-201; LayoutTab (section 7).

**Headers and footers**
- Default, first and even variants, distances: S/lib/storage/headerFooter.ts.
- Editors: C/HeaderFooterLayer.svelte:75-89.
- Undo stack shared with the body: S/lib/editor/extensions/stateHistory.ts:115,168.
- Fields: page number, page count, chapter (header/footer only): S/lib/editor/extensions/pageField.ts:8,30.

**Page decoration**: background, border (width, padding), watermark (text, colour, angle, transparency): S/lib/storage/pageDecor.ts:13-36; C/PageDecorDialog.svelte.

**Line numbering**: S/lib/storage/lineNumbering.ts:10-37.

**Fold marks**: S/lib/storage/foldMarks.ts:10.

**Footnotes and endnotes**
- Insert and go to note: S/lib/editor/extensions/notes.ts:40-332.
- Settings: S/lib/storage/noteSettings.ts:3; C/NoteOptionsDialog.svelte.

## 17. AI assistant (bring your own provider)

**Providers and requests**
- Presets: OpenAI, Anthropic, Mistral, OpenRouter, Gemini (OpenAI-compatible), Ollama, LM Studio, custom: S/lib/storage/ai.svelte.ts:68-76.
- Three wire formats, called directly from the browser with SSE: S/lib/ai/client.ts:59-174.
  - OpenAI-style chat completions.
  - Ollama native.
  - Anthropic messages, sent with `anthropic-dangerous-direct-browser-access`.

**Enabling**
- Default `enabled:true`, but nothing works until an endpoint and model are set: ai.svelte.ts:27-28,55-58.
- The pane mounts only when enabled: S/App.svelte:1969.

**Key storage**: the API key is stored in plaintext in localStorage `edentext-ai`: ai.svelte.ts:60-65.

**Modes and tools**
- Chat and Edit modes. Edit-mode text changes are recorded as tracked changes by the AI author. Maximum 8 tool rounds per turn: S/lib/ai/tools.ts:1-3,54-83,1116.
- 18 tools: S/lib/ai/tools.ts:111-318.
  - read_paragraphs, replace_text, rewrite_paragraph, insert_paragraphs, delete_paragraphs
  - format, set_style, insert_frame, frame
  - reply_comment, resolve_comment, add_comment
  - table, set_header_footer, set_language, set_page, review, set_columns

**Commands and entry points**
- Slash commands /draft /rewrite /rephrase /shorten /formal /fix /translate, plus user-defined commands: S/lib/ai/commands.ts:20-52.
- Alt+I draft at the caret: S/lib/editor/shortcuts.ts:68; S/App.svelte:1490.
- An @AI mention in a comment gets an answer in the thread: tools.ts:1215-1225; C/CommentCard.svelte:38.
- Attachments (.docx .dotx .odt .ott .txt .md .csv .html) are read locally: S/lib/ai/sources.ts:11-37.

**Chat and pane storage**: chat history per document in `edentext-ai-chat`; pane width in `edentext-ai-width`; pane side left/right in Settings.

**Korean UI strings** for AI: overlays/edentext/ko.ts:18-28.

## 18. Proofing: spell, grammar, thesaurus, autocorrect, autotext, word completion

**Spelling**
- Engine: Hunspell WASM (hunspell-asm): S/lib/spell/dictionary.ts:1-45.
- Dictionaries are served from the app's own `dictionaries/<code>/`: de, el, en, en-GB, es, fr, pt, ru, uk (source/edentext/public/dictionaries).
- **No Korean dictionary.** ja-JP, zh-CN and zh-TW are listed as `noDict`: S/lib/storage/documentLanguage.ts:28-40.
- Personal dictionary and ignore-all: S/lib/spell/controller.ts:5-112.
- Squiggles are drawn as CSS highlights: S/lib/editor/extensions/spellCheck.ts:247.

**Grammar**
- harper.js worker: local, English only, off by default, American/British by document language: S/lib/spell/grammar.svelte.ts:1-169.
- Squiggles: S/lib/editor/extensions/grammarCheck.ts:127.

**Thesaurus**
- Bundled MyThes data for de, en, es, fr, pt, ru, uk; up to 12 groups: S/lib/spell/thesaurus.ts:5-44.
- Dialog: C/ThesaurusDialog.svelte.

**Document language**: per document, with an "other" slot (`none` turns checking off): S/lib/storage/documentLanguage.ts:43-111. UI: LanguagePicker in the status bar and Review tab.

**AutoCorrect**
- Language-aware smart quotes, dashes, replacement table, capitalise first letter of sentence, TWo INitials, URL recognition: S/lib/editor/extensions/autoCorrect.ts; S/lib/storage/autoCorrect.ts:5-18.
- Dialog: C/AutoCorrectDialog.svelte:36-90.

**Word completion**
- Suggests after 3 letters; Enter accepts, Esc dismisses.
- Options: minimum length, append space, 1000 entries, clear the list.
- Evidence: S/lib/editor/extensions/wordCompletion.ts:42-86; S/lib/storage/wordCompletion.ts:13-17.

**AutoText**: library of `{name, shortcut, content}`; add from selection; shortcut + F3 expands: S/lib/editor/extensions/autoText.ts:28-43; C/AutoTextDialog.svelte:26-80.

## 19. Find / replace
- Options: match case, whole word (Unicode-aware), regex with `$1`–`$9` and `$&`: S/lib/editor/extensions/searchReplace.ts:16,70-97,272-276.
- Format search and format-only replace (weight, italic, underline, font, size, colour, paragraph style): searchReplace.ts:16-55,173.
- Next/previous with wrap; replace and replace all: searchReplace.ts:218,293-389.
- Find bar: toggles, match count, format row: C/FindReplaceBar.svelte:87-192. Enter / Shift+Enter move between matches: :116-119.

## 20. Clipboard / paste
- Body `transformPasted` fitting:
  - no-break spaces become plain spaces;
  - content is flattened in notes and header/footer;
  - invented boxes are unwrapped;
  - remote images are dropped;
  - the caret's font is carried over.
  - Evidence: S/lib/editor/paste.ts:8-110; C/Editor.svelte:1336; C/HeaderFooterLayer.svelte:496.
- Image paste (only when there is no text) and image drop: C/Editor.svelte:1315-1333.
- Context-menu paste reads `navigator.clipboard` (HTML, then text), with an alert when blocked: contextMenuItems.ts:43-66.
  - The shell iframe grants `clipboard-read; clipboard-write`: src/EditorShell.svelte:137.
- Paste without formatting: HomeTab.svelte:234; R/commands.ts:45.
- There is no Paste Special dialog.

## 21. Comments and track changes (model)
- Comments: threaded replies, resolve, edit, remove, author = document properties author: S/lib/editor/extensions/comment.ts:114-144; S/App.svelte:1119.
- Track changes: insertion/deletion marks, recording, accept/reject one or all, author colours: S/lib/editor/extensions/trackChanges.ts:40-162.
- Display options:
  - markup modes, balloons vs pane, print markup: S/lib/storage/markup.svelte.ts:9-16; S/lib/storage/printMarkup.svelte.ts:6;
  - change bars: C/ChangeBarLayer.svelte.

## 22. TOC, citations, bibliography, index, captions, cross-references, bookmarks
- Index families: toc, figures, tables, bibliography, alphabetical. Options: leader, columns, page numbers, citation style. Update fully or page numbers only: S/lib/editor/extensions/tableOfContents.ts:67-155.
- Index entries: S/lib/editor/extensions/indexEntry.ts:17-81.
- Citations: S/lib/editor/extensions/bibliographyEntry.ts:83-207.
- Caption sequence fields: S/lib/editor/extensions/caption.ts:59,113.
- Bookmarks: set, unset, remove, go to (modeless dialog): S/lib/editor/extensions/bookmark.ts:104-112; C/BookmarkDialog.svelte.
- Cross-references:
  - targets: heading, numbered paragraph, bookmark, figure, table, footnote, endnote;
  - formats: page, above/below, text, number in three contexts, caption parts.
  - Evidence: S/lib/editor/extensions/crossReference.ts:67-72; C/CrossRefDialog.svelte; kinds at overlays/edentext/ko.ts:9.
- Placeholder fields, with Tab moving between them: S/lib/editor/extensions/placeholderField.ts:20-75.
- Date/time fields, fixed or auto-updating: S/lib/editor/extensions/dateTimeField.ts:31-59.

## 23. Print / PDF
See 1.1 and 1.6. Three paths:
- Raster PDF download.
- Raster print (Ctrl+P and the printer button).
- Vector PDF via the browser print dialog.

Review markup printing is a toggle (section 9).

## 24. Autosave, recovery, snapshots, browser document slots, locks

**Autosave**
- Debounced 1 s, writes chained in order, pictures moved to IndexedDB.
- Synchronous flush on hidden/pagehide.
- A quota alert is shown once per session.
- Evidence: S/lib/storage/autosave.ts:15-113.

**Crash recovery**
- A boot flag `edentext-doc-loading` detects a failed start; the user is asked to retry.
- If declined, the copy is parked as `edentext-doc-broken` and snapshots are offered newest-first.
- Evidence: autosave.ts:118-171.

**Snapshots**: 3 kept, at most every 5 minutes, in IndexedDB `edentext-snapshots[@id]`. They are offered only during recovery: S/lib/storage/snapshots.ts:8-43.

**Document slots** (one per tab, docId in sessionStorage)
- Tab presence uses a Web Lock plus a 60 s heartbeat (10-minute staleness fallback).
- Pruning keeps at most 10 documents; held, first and own documents are kept.
- Retention options: keep / drop closed / store nothing (volatile).
- Evidence: S/lib/storage/docScope.ts:10-261.
- **[product]** In the iframe, `startTabPresence` and `pruneOldDocuments` run only when hosted: B:103-105.

**UI**
- Browser Documents dialog (open, delete): C/BrowserDocumentsDialog.svelte:16-50.
- ResumeCard: C/ResumeCard.svelte.

**Images**: shared IndexedDB image store, keyed by content hash, swept by scanning `idb:` references: S/lib/storage/imageStore.ts:8-117.

**Unload protection**
- Word's own `beforeunload` warning: S/App.svelte:238-247.
- **[product]** The shell also warns when any engine is dirty or busy: src/EditorShell.svelte:100-104.
- **[product]** The shell confirms before Back to the start page: src/EditorShell.svelte:88-96.

## 25. Recent files and permission re-request
- Labels are in localStorage `edentext-recent-files` (max 8); handles are in IndexedDB `edentext-recent/handles`: S/lib/storage/recentFiles.ts:7-10,41-52.
- Duplicates are detected with `isSameEntry`: recentFiles.ts:77-83.
- A startup prune runs only when FS Access is supported: S/App.svelte:715-717.
- Reopening uses `queryPermission` and then `requestPermission`: recentFiles.ts:123-141.
  - "gone": alert and forget the entry. "denied": alert and keep it. Evidence: S/App.svelte:1303-1322.
- The document is re-bound to its file after a reload via `edentext-doc-file`: S/App.svelte:719-729.
- Clear recent files: File menu or Settings ▸ Privacy.
- **[product]** Recent entries for HWP save use the same list: P:153.

## 26. Keyboard shortcuts

The single fixed table is S/lib/editor/shortcuts.ts:7-69. Shortcuts are **not user-customisable** (comment at shortcuts.ts:3-5). Editor bindings are at S/lib/editor/extensions/shortcuts.ts:50-106; app bindings at S/App.svelte:1466-1501.
- **[product]** App shortcuts are suppressed while a Hangul save or the workbench is active: P:168.

**Character**
- Mod-Shift-P superscript; Mod-Shift-B subscript.
- Mod-Shift-. grow font; Mod-Shift-, shrink font.
- Mod-M or Mod-Space clear formatting.
- TipTap defaults:
  - Mod-B / I / U: bold / italic / underline.
  - Mod-Shift-S: strikethrough.
  - Mod-Shift-H: highlight.
  - Mod-Shift-7 / 8: lists.
  - Source: S/lib/editor/CLAUDE.md.

**Paragraph**
- Mod-L / E / R / J: align.
- Mod-1 / 2 / 5: line spacing 1 / 2 / 1.5.
- Mod-Alt-1…6: Heading 1–6 (matched by `event.code`); Mod-Alt-0 and Mod-Shift-N: Standard.
- Tab / Shift-Tab: indent and list level.

**Insert**
- Mod-K: link.
- Mod-Enter: page break.
- Mod-Shift-Space: no-break space.
- Mod-Shift-Minus: soft hyphen.
- Alt-Shift-D / T: date / time field.
- Mod-Alt-F / D: footnote / endnote.

**App**
- Mod-O / S / P: open / save / print.
- Mod-F / H: find / replace.
- F3 / Shift-F3: find next / previous (F3 first tries AutoText).
- Mod-F10: formatting marks.
- F5: navigator.
- Mod-F7: thesaurus.
- Mod-Alt-S: split view.
- Mod-+ / - / 0: zoom.
- Alt-Q: command search.
- Alt-I: AI draft.
- Esc: close the find bar.

**Other bindings**
- Undo/redo: Mod-Z, Shift-Mod-Z, Mod-Y, including Russian-layout variants: stateHistory.ts:39-45.
- Tab between placeholders; arrow keys out of a text box; Enter rules in columns and before a leading table; Enter/Esc for word completion.

**Shortcut labels**: localised (⌘⇧⌥ on Mac): S/lib/i18n/shortcut.ts:7-15.
- Korean has no `shortcut` group, so it falls back to the English Ctrl/Shift/Alt labels: overlays/edentext/ko.ts, which has no `shortcut:` key.

## 27. UI language / i18n

**Locales**
- Upstream has 11 locales: S/lib/i18n/config.ts:4.
- **[product]** Adds `ko` as the first locale, and its catalogue: P:833-859.
- **[product]** The default is `ko` instead of following the browser: P:930-934.
- **[product]** The Korean catalogue overrides most groups on top of `...en`: overlays/edentext/ko.ts:4-5.
  - Partly English: template samples (ko.ts:3,14) and parts of `ai` / `autoCorrect` (they spread `en`).
  - Fully English: the `shortcut` group.
- **[product]** Intl tag `ko-KR`: P:983.

**Switching language**
- Settings ▸ General ▸ Language: C/SettingsDialog.svelte:128-133.
- The ribbon language picker is **[hidden]** (section 4.1).

**Also**
- `<html lang>` follows the locale: S/main.ts:21.
- Import messages are localised: S/lib/i18n/importMessages.ts:11-24.

## 28. Settings dialog (C/SettingsDialog.svelte, five sections)

**General**
- Language (12 locales in the product): :128-133.
- Theme light / dark / all black / auto: :134-143.
- Accent, 7 colours: :144-151; S/lib/storage/theme.ts:131.
- **[DEV]** Ribbon/modern switch: :152-164.

**Editing**
- Word completion on/off, append space, minimum length, clear: :167-188.
- Grammar check: :189-192.
- Number recognition: :193-196.
- Open AutoCorrect: :197-200.

**View**: ruler, formatting marks, field shading: :203-214.

**AI**
- Enable, pane side, provider, endpoint, model, context size (≥2048), API key: :217-254.
- Test connection: :255-260,73-83.
- Custom slash commands: :261-276.

**Privacy**
- Document retention keep / closed / none, with a restart notice: :279-291.
- Clear recent files: :292-295.

**Opened from**: the ribbon gear (visible in the product) and the AI pane's settings link: S/App.svelte:1970.

**Other dialogs in the same area**
- Document properties (title, subject, author, keywords, description; also sets the comment author): C/DocPropertiesDialog.svelte:45-61; S/lib/storage/docProperties.ts:6-21.
- AutoCorrect, AutoText, Browser Documents, Password, About (upstream).

## 29. Product shell integration [product]

**State bridge**
- The Word iframe exposes `window.sketchWord = { state(), about() }`: SB:13-19.
- It reports `{ready, busy, dirty, name}` to `parent.sketchShell.wordState` on every change: SB:3-12.
  - busy = productTasks, busyTask, pdfBusy or hangulSaving.
  - dirty = for a file-backed document, doc or rest-sum differs from the clean copy; otherwise the document is non-empty.
  - name = documentName, or "새 문서".
- `productTasks` wraps handleSave, handleSaveAs, handleOpen and handleOpenRecent: B:79-89.
- In the shell: `wordState` is at src/EditorShell.svelte:110, and status polling is at :71-73.

**Hosted styling**: the `sketch-hosted` class is set on the iframe's html element: SB:16.

**Shell header** (src/EditorControls.svelte:8-19)
- Mounted inside Word's `.ribbon-tabs` row: src/EditorShell.svelte:38-59.
- In the modern chrome it reserves 172 px of padding instead: src/EditorShell.svelte:42-46.
- Engine switch: W, 한, PDF, X (Excel).
  - Disabled while any engine is busy: src/EditorControls.svelte:12-15; src/EditorShell.svelte:70,76-87.
  - The last-used engine is remembered under `sketch-docs-last-engine`: src/engines.ts:5-10.
- ⓘ opens the product About dialog: src/AboutProduct.svelte.
  - It shows version, licence, source links and upstream commits.
  - "EdenText 정보" opens the upstream About dialog: src/AboutProduct.svelte:40.

**Engine loading and routing**
- Engine download progress before mount: src/EngineProgress.svelte; src/EditorShell.svelte:136-140.
- The iframe waits for `offlineReady` (≤10 s): src/offline.ts:4-22.
- URL routing word.html / hwp.html / pdf.html / xlsx.html with history push/pop: src/routes.ts; src/EditorShell.svelte:74-99.
- HWP hand-off from Word (open or menu) goes to the shell's Hangul engine: B:67-78; src/EditorShell.svelte:111-122.

**Not in the product**
- Standalone engine visits redirect to the shell: B:103-106.
- Upstream static intro and analytics are removed (section 0).

## 30. Offline
- **[product]** Product service worker `public/sw.js`, cache `sketch-docs-<build>`: public/sw.js:2-3.
  - Install precaches `./`, `./word.html`, `./hwp.html` and their assets: :16-24.
  - Runtime is network-first with cache fallback, which also stores the Word engine and its dictionaries once fetched: :44-66.
  - It deletes the upstream `edentext-v*` and `edentext-shell-*` caches: :4,30.
  - Not cached: rhwp, gridcraft, legal, pdfjs: :72.
- The upstream EdenText worker (cache `edentext-v3`, source/edentext/public/sw.js:5) is **[hidden]** (B:101). Its file is still copied into public/engines/word/sw.js but is never registered.
- Inferred: Word works offline only after the engine files and the needed dictionaries have been fetched once online. This was not verified in a browser here.

## 31. Accessibility (found in passing; no dedicated audit)
- Picture alt text: FrameTabs.svelte:134-150. It is imported from DOCX at docx.ts:2553-2555.
- ARIA roles and labels on menus and dialogs (examples):
  - role="menu" / "menuitem": S/App.svelte:1724-1770;
  - aria-expanded: R/Ribbon.svelte:474-483;
  - color picker radiogroups: C/SettingsDialog.svelte:146-148;
  - context menu keyboard navigation: C/ContextMenu.svelte:79,115-139.
- Native `<dialog>` with draggable dialogs: S/main.ts:14.
- `<html lang>` follows the UI locale: S/main.ts:21.
- No tagged PDF (section 1.6).
- **[product]** The shell header has aria-labels and aria-pressed: src/EditorControls.svelte:8-17.
- **Not determined**: screen-reader behaviour of the editing surface, the full keyboard reach of the ribbon (beyond Alt+Q search), and high contrast beyond the "all black" theme.

## 32. Anything else
- Undo/redo history dropdown with multi-step jump: C/HistoryButton.svelte.
- Undo is shared between the body and header/footer zones.
- Split view, pages side by side (1–4), zoom range 20–300, zoom persisted (`edentext-zoom`): S/App.svelte:264,548.
- Themes: light, dark, all black, auto (follows the system), plus 7 accent colours: S/main.ts:17-26.
- Bundled fonts and metric-compatible stand-ins: S/styles/global.css:9-299.
  - Liberation Serif, Sans and Mono; Carlito; Caladea; STIX Two Math; EdenText Symbols/Space/Quotes.
  - Calibri → Carlito, Arial → Liberation Sans, Cambria → Caladea, Courier New → Liberation Mono, Times → Liberation Serif.
- "Load all fonts" through the Local Font Access API: S/lib/utils/fontDetect.ts:160-181.
- Embedded document fonts: register, persist in `edentext-fonts[@id]`, re-export: S/lib/fonts/embeddedFonts.ts:10-46.
- The modern toolbar's horizontal scrollbar and wheel scrolling: S/App.svelte:622-680.
- Ribbon command search with an MRU list (`edentext-recent-commands`): R/CommandSearch.svelte.
- Warnings on open: images skipped, shapes removed, structure repaired, missing fonts, etc. The Korean texts are at overlays/edentext/ko.ts:16-17.

---

## 33. Browser storage used by the Word app

**Scoping.** `docKey(name)` appends `@<docId>`. The first document's id is empty, so its keys have no suffix: S/lib/storage/docScope.ts:111-114.

**Context.** The Word app runs in a same-origin iframe, so all of these share the product origin with the other engines.

### localStorage: app-wide
| Key | Purpose | Evidence |
|---|---|---|
| edentext-keep-documents | retention mode | S/lib/storage/docScope.ts:72-83 |
| edentext-live@<id> | tab-presence marker | docScope.ts:14,46-51 |
| edentext-recent-files | recent-file labels (max 8) | S/lib/storage/recentFiles.ts:7,10 |
| edentext-app-language | UI locale (**[product]** default ko) | S/lib/storage/appLanguage.ts:6; P:929-934 |
| edentext-theme / edentext-accent | theme / accent | S/lib/storage/theme.ts:7-8 |
| edentext-toolbar-expanded, edentext-chrome, edentext-ribbon-collapsed | chrome state | theme.ts:9-11 |
| edentext-formatting-marks, edentext-field-shading, edentext-ruler, edentext-split, edentext-page-columns | view toggles | theme.ts:12-16 |
| edentext-recent-commands | command-search MRU | theme.ts:17 |
| edentext-zoom | zoom | S/App.svelte:264,548 |
| edentext-autocorrect | AutoCorrect flags | S/lib/storage/autoCorrect.ts:14 |
| edentext-autotext | AutoText library | S/lib/storage/autoText.ts:16 |
| edentext-word-completion | options and collected words | S/lib/storage/wordCompletion.ts:13 |
| edentext-grammar-check | Harper on/off | S/lib/spell/grammar.svelte.ts:9 |
| edentext-user-dictionary | personal dictionary | S/lib/spell/controller.ts:5 |
| edentext-number-recognition | table number recognition | S/lib/storage/tableOptions.svelte.ts:10 |
| edentext-print-markup | print review markup | S/lib/storage/printMarkup.svelte.ts:6 |
| edentext-markup-mode, edentext-markup-comments, edentext-markup-changes, edentext-markup-comment-place, edentext-markup-change-place | review display | S/lib/storage/markup.svelte.ts:9-13 |
| edentext-ai | AI settings including the plaintext API key | S/lib/storage/ai.svelte.ts:17 |
| edentext-ai-width | AI pane width | C/AiPane.svelte:118 |
| edentext-recent-fonts | recent fonts | C/ToolbarExpanded.svelte:63; R/fontList.svelte.ts:12 |
| edentext-recent-chars | recent special characters | C/SpecialCharPicker.svelte:25 |
| edentext-download-hint | one-time download hint | S/lib/export/saveFile.ts:8 |
| sketch-docs-last-engine **[product, shell]** | last engine used | src/engines.ts:5 |

### localStorage: per document (`docKey`; an in-memory Map when retention is "none")
| Key | Purpose | Evidence |
|---|---|---|
| edentext-doc | autosaved TipTap JSON | S/lib/storage/autosave.ts:7 |
| edentext-doc-loading | crash/boot flag | autosave.ts:11 |
| edentext-doc-broken | parked unloadable copy | autosave.ts:14 |
| edentext-doc-name | document name | S/lib/storage/documentName.ts:6 |
| edentext-doc-format | format; **[product]** accepts docx, hwp, hwpx, otherwise odt | documentName.ts:44; P:951-962 |
| edentext-doc-protected | protected flag | documentName.ts:57 |
| edentext-doc-file | {id, modified} link to the recent handle | documentName.ts:71 |
| edentext-doc-properties | document properties | S/lib/storage/docProperties.ts:17 |
| edentext-doc-language / edentext-doc-language-other | proofing language | S/lib/storage/documentLanguage.ts:43-44 |
| edentext-styles | style sheet | S/lib/styles/sheet.svelte.ts:11 |
| edentext-header, edentext-header-first, edentext-header-even, edentext-footer, edentext-footer-first, edentext-footer-even | header/footer zones | S/lib/storage/headerFooter.ts:136-137 |
| edentext-hf-sections, edentext-hf-different-first, edentext-hf-odd-even, edentext-hf-distances | header/footer extras | headerFooter.ts:90,141,143,174 |
| edentext-ai-chat | AI conversation | S/lib/storage/aiChat.ts:6 |
| edentext-record-changes | track changes on/off | S/lib/storage/trackChanges.svelte.ts:8 |
| edentext-page-margins, edentext-page-orientation, edentext-page-format, edentext-page-numbering, edentext-page-decor, edentext-page-rtl | page setup | S/lib/storage/pageMargins.ts:24; pageOrientation.ts:5; pageFormat.ts:12; pageNumbering.ts:11; pageDecor.ts:9; writingMode.ts:7 |
| edentext-tab-interval, edentext-spacing-model, edentext-spacing-at-page-start, edentext-balance-spaces | paragraph model | S/lib/storage/tabInterval.ts:3; spacingModel.ts:8,23; balanceSpaces.ts:7 |
| edentext-line-numbering, edentext-line-grid, edentext-hyphenation, edentext-fold-marks, edentext-notes | layout extras | S/lib/storage/lineNumbering.ts:8; lineGrid.ts:8; hyphenation.ts:8; foldMarks.ts:7; noteSettings.ts:3 |

### sessionStorage
- `edentext-tab-doc`: which document this tab edits: docScope.ts:10,57-59,251.

### IndexedDB (each database at version 1 with one store; S/lib/storage/idb.ts:5-11)
| Database | Store | Per document? | Purpose | Evidence |
|---|---|---|---|---|
| edentext-images | images | no, shared | pictures ≥ 4 KB, keyed by hash | S/lib/storage/imageStore.ts:8-13 |
| edentext-snapshots[@id] | snapshots | yes | recovery snapshots | S/lib/storage/snapshots.ts:8-9 |
| edentext-fonts[@id] | fonts (key `current`) | yes | embedded fonts | S/lib/storage/embeddedFontStore.ts:8-10 |
| edentext-recent | handles | no | FileSystemFileHandle per recent file | S/lib/storage/recentFiles.ts:8-9 |

### Web Locks
- `edentext-doc@<docId>`: held for the tab's lifetime: docScope.ts:18,118.
- Other code checks held documents with `navigator.locks.query()`: docScope.ts:143.

### Cache API
- **[product]** `sketch-docs-<build>`: public/sw.js:3.
- **[hidden]** The upstream `edentext-v3` (source/edentext/public/sw.js:5) is not registered: B:101. The product worker deletes leftover `edentext-v*` caches: public/sw.js:4,30.

### Not used
- OPFS, BroadcastChannel and `navigator.storage.persist` / `estimate`: no matches in source/edentext/src or public (search by sub-agent).

### Window events (not storage)
- `edentext-ai-chat`, `edentext-ai-comment`: ai.svelte.ts:20,22.
- `odf-open-command-search`: R/CommandSearch.svelte:34.

---

## 34. What I could not determine
- **No runtime check.** Every item comes from reading code. Nothing was clicked in the built product.
  - Most important: the effect of the product CSS hiding was not seen in a browser. That covers the ribbon theme, language and logo.
  - The offline behaviour of the Word engine through the product worker was not checked either.
- **Pre-patch line numbers.** Upstream line numbers come from the unpatched clone. Lines after the patch hunks in S/App.svelte and R/Ribbon.svelte are shifted by a few lines in the built copy.
- **Inferred items.** Items marked "inferred" were concluded from missing code, not from tests:
  - w:vanish, moveFrom/To, OLE, WEBP/AVIF dropped on DOCX export, PDF text layer with CJK.
- **Save as HWP/HWPX from Word.** I judged this unreachable from the visible UI (section 1.4). A user with a leftover `edentext-doc-format=hwp` key could still trigger it. Treat it as "code present, not a user feature" unless the team says otherwise.
- **Modern chrome.** Treated as non-baseline because only DEV builds offer the switch. It is reachable if `edentext-chrome=modern` is already stored, e.g. from an earlier dev session on the same origin.
- **Not exhaustively itemised.**
  - Every string in the 12 locales.
  - Every option inside the large dialogs: StyleManagerDialog (1227 lines), NoteOptionsDialog, CrossRefDialog format matrix, ParagraphDialog fields.
  - These are listed at dialog level. A WordCraft parity check should open each dialog file.
