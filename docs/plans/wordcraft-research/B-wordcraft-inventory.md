# WordCraft web build: capability inventory (plan B input)

Clone: `storytold/wordcraft` at `a8c1c22` (a fresh read-only clone outside this repo). All paths below are relative to that clone.
**Method:** I only read the source and docs. I did not run cargo, trunk, a browser or any tests, and I did not measure WASM size. Every claim is "the code says"; none of it is "I ran it". Items marked **(unverified)** are inferences that need a running build to confirm.

How the web build differs from desktop: `apps/wordcraft-web` runs the same `WordApp` (crates/ui-egui) inside eframe's web runner and injects only web `Services` (`apps/wordcraft-web/src/web.rs:172-209`). Desktop-only code is cut out with `#[cfg(not(target_arch = "wasm32"))]`. No crate in the workspace defines a cargo `[features]` table. I checked all 19 `Cargo.toml` files, and `rg 'cfg\(.*feature'` finds 0 hits in Rust code.

---

## 0. The five claims we already knew, checked

| Claim | Result | Evidence |
|---|---|---|
| ODT import skips notes/annotations/text boxes | **Confirmed** | `crates/formats/src/odt.rs:1634-1643` (`"note" \| "annotation" \| "text-box" \| … => self.skip = 1`). The module doc says the same at `odt.rs:10-11`. The project's own parity doc for ODT says "No footnotes, comments, fields or RTL" (`docs/file-format-parity.md:30`) |
| Web sets `app.autosave = false` | **Confirmed** | `apps/wordcraft-web/src/web.rs:66`. AutoSave is also blocked by design: `AutoSaveBlock::Browser` (`crates/ui-egui/src/lib.rs:1834-1835`, message at `:2155-2156`) |
| No Korean UI | **Confirmed** | `crates/ui-egui/src/i18n/mod.rs:55` `LANGUAGES: [LangInfo; 20]`, which has no `ko` entry and no `ko.tsv` in `crates/ui-egui/src/i18n/` |
| DOCX encryption exists, ODT encryption doesn't | **Confirmed** | DOCX agile AES encryption: `crates/docx/src/crypt.rs:1-14`. It is applied only to Word packages: `crates/engine/src/io.rs:115-117` (`can_encrypt` = `is_word_package`) and `io.rs:320-325`. `rg 'manifest:encryption\|encryption-data' crates` finds 0 hits. `.doc` decryption is read-only (XOR/RC4/RC4 CryptoAPI): `crates/docbin/src/crypt.rs:1-15` |
| No OTT template export | **Confirmed** | `SAVE_EXTS` has no `ott` (`crates/engine/src/io.rs:31`). `formats::EXTENSIONS` has no `ott` (`crates/formats/src/lib.rs:27`). The only `ott` hit in Rust is an Italian grammar word (`crates/proof/src/it/grammar.rs:118`). The OPEN list has no `ott` either (`io.rs:9-29`), so `.ott` cannot even be opened |

---

## 1. Formats: read and write (all pure Rust, so all compiled into wasm)

Dispatch: `crates/engine/src/io.rs:173-204` (read), `io.rs:302-316` (write), and `crates/engine/src/io_ext.rs:7-39`. The web file picker accepts `DOC_EXTS` (`apps/wordcraft-web/src/web.rs:12`): docx docm dotx dotm doc dot odt rtf txt md html htm tex json xml.

| Format | Read | Write | Engine | Notes / losses |
|---|---|---|---|---|
| .docx | ✅ | ✅ | `wordcraft_docx::read` (`io_ext.rs:9`), `write_as(flavor)` (`io_ext.rs:26-27`) | Full model. The project's own estimate is ~65% fidelity, tested on synthetic fixtures only (`docs/file-format-parity.md` docx row) |
| .docm / .dotx / .dotm | ✅ | ✅ | same, `Flavor::from_ext` | Macros are kept on save but never run (parity doc, docm row) |
| .doc / .dot | ✅ | ❌ | `wordcraft_docbin` (`io_ext.rs:10`, `io.rs:184-188`) | No writer |
| .xml (Flat OPC / Word 2003 XML) | ✅ | ✅ | `read_xml`, `write_flat`, `write_wordml2003` (`io_ext.rs:12, 30-31`) | 2003 XML drops shapes, text boxes, equations and more on write (parity doc row 35) |
| .odt | 🟡 | 🟡 | `formats::odt` via the shared "flow" model (`crates/formats/src/model.rs:1-3`) | Kept: styles, lists, tables, pictures, headers/footers, sections, tracked insertions/deletions. **Not kept: footnotes, comments, fields, RTL, text boxes** (`odt.rs:1634-1643`; parity doc :30). Note that `keeps_everything()` still classes `odt` and `rtf` as lossless for the "document saved" flag (`crates/ui-egui/src/lib.rs:2178-2181`), so saving to .odt clears dirty even though content is lost |
| .ott | ❌ | ❌ | — | not in any list (see §0) |
| .rtf | 🟡 | 🟡 | `formats::rtf` | Import skips headers, footers, notes and objects (`crates/formats/src/rtf.rs:10-11`). Export writes one section only (parity doc :29) |
| .html / .htm | 🟡 | 🟡 | `formats::html` (`lib.rs:34, 54, 67`) | Not lossless. With Print Markup, comments are appended (`lib.rs:85-93`) |
| .md | ✅ | ✅ | `formats::markdown` | CommonMark subset plus GFM tables (`formats/src/lib.rs:2`) |
| .tex | ✅ | ✅ | `formats::latex` | includes math (parity doc) |
| .txt | ✅ | ✅ | `formats::txt` (`io.rs:190, 306-309`) | legacy encodings via encoding_rs/chardetng |
| .json (internal model) | ✅ | ✅ | serde (`io.rs:191-195, 310`) | "for agents" |
| PDF export | — | ✅ | `wordcraft_pdf::export` / krilla (`io_ext.rs:33-36`) | Print Markup option. PDF import does not exist (parity doc "PDF open" 0%) |
| PNG page image | — | ✅ | `render_png` (`io_ext.rs:43-49`) | one page |
| .xlsx/.xlsm/.xls/.ods | data only | — | `formats::sheet` (`formats/src/sheet.rs:1-4`) | mail-merge recipient source only |

**Encryption on web:** `file.save` / `file.saveAs` with `password` encrypts Word packages before download (`crates/ui-egui/src/lib.rs:826-844`). Web random numbers come from `getrandom` with `wasm_js` (`crates/docx/Cargo.toml`, target section). Opening encrypted .docx and .doc works through `open_bytes_with` (`io.rs:143-160`) **(password prompt on web unverified)**.

**Cargo features to shrink WASM:** none exist. `crates/formats/Cargo.toml` has no `[features]`, and `formats::import`/`export` match every format unconditionally (`crates/formats/src/lib.rs:30-71`). Dropping rtf/html/markdown/latex/txt/sheet would require patching the source (new `#[cfg(feature=…)]` gates in `formats/src/lib.rs`, `engine/src/io_ext.rs`, and the mail-merge sheet path).

---

## 2. Opening and saving files on web

| Topic | Behaviour | Evidence |
|---|---|---|
| Open | `rfd::AsyncFileDialog` → bytes → `Inbox` → `drain_inbox` runs `file.open` with base64 `data` | `web.rs:176-196`; `crates/ui-egui/src/lib.rs:2025-2050`; `file_dialogs.rs:296-301` |
| Drag and drop | dropped files are read asynchronously into the inbox | `web.rs:96-112` |
| Save / Save As / Export PDF / Export PNG | **all go through `download`**: `showSaveFilePicker` when present, otherwise `<a download>` | `crates/ui-egui/src/lib.rs:822-871`; `web.rs:238-257` (picker detection and fallback), `web.rs:363-385` (anchor) |
| File handle | **Not kept.** The picker's handle is used once (`write_file_handle`, `web.rs:337-361`) and then dropped. Every Save opens the picker again. `pick_save` just echoes the suggested name (`web.rs:198`) | `web.rs:259-335` |
| Save outcome tracking | `AsyncSaves` tickets; the document counts as saved only after the picker's write/close succeeds | `crates/ui-egui/src/async_saves.rs:1-10`; `web.rs:305-332` |
| Default name | `<title>.docx` unless the open file was a Word package | `crates/ui-egui/src/lib.rs:1617-1623` |
| Leave-page guard | `beforeunload` while dirty or while a save is pending | `web.rs:221-235` |
| Disabled on web (needs a path) | Compare/Combine "another file" ("Comparing with another file needs the desktop app.", `crates/ui-egui/src/dialogs_review.rs:172-174, 193-195`). Templates & Add-ins Attach/Organizer Browse (`dialogs_templates.rs:55-58, 73, 214`). `file.newFromTemplate`, `file.saveTemplate`, `insert.object`, `insert.textFromFile` take a `path`, and `io::read_file`/`save_path` return errors on wasm (`crates/engine/src/cmd/tools.rs:417-434, 504-508`; `io.rs:472-475, 546-575`). Built-in file browser (`lib.rs:53-54`). Adding a font by path (`cmd/font.rs:58-62`). A path-based dialog without a picker cancels (`file_dialogs.rs:176-179`) | — |
| Saving a template on web | Save As with a `.dotx` name works because it goes through the download branch (any `SAVE_EXTS` ext) **(unverified in UI)** | `lib.rs:823` |
| URL flags | `?webgl` (force WebGL2), `?sample` (sample doc). No others | `web.rs:9, 36-40, 59-60` |

## 3. Recovery, autosave and snapshots on web

- AutoSave: off (`web.rs:66`) and blocked (`AutoSaveBlock::Browser`, `crates/ui-egui/src/lib.rs:1834-1835, 2141-2157`).
- Crash recovery: desktop only. `mod desktop` is cfg-gated (`crates/engine/src/recovery.rs:1, 14-17`). `file.recover` on wasm returns "local recovery is available on desktop only" (`recovery.rs:128-129`). `docs/recovery.md:25, 55` says the same.
- Version History (`file.versions`): **in-memory only**, at most 50 per session (`crates/engine/src/cmd/tools.rs:396-402`; `session.rs:414-415`). It is lost on reload.
- Preferences (interface language, custom keyboard map, options) are **not persisted on web**. The desktop saves prefs in `apps/wordcraft/src/main.rs:97,124,139`. `web.rs` has no prefs code, and eframe is built without its `persistence` feature (`apps/wordcraft-web/Cargo.toml:27`) **(inferred: nothing persists; not run)**. The only persistent browser state is user fonts in IndexedDB (`apps/wordcraft-web/src/web/font_store.rs:1-3, 10-11`).

## 4. Interface languages (i18n)

- Mechanism: English source strings are the keys. One TSV per language, `context<TAB>English<TAB>translation`, with format and escapes documented in `crates/ui-egui/src/i18n/zh-hans.tsv:1-13`, parsed by `i18n/catalog.rs:81-114`. Catalogs are **compiled in** with `include_str!` (`i18n/mod.rs:55-149`). A missing entry falls back to English.
- Adding a language: add `xx.tsv` and one `LangInfo` row in `LANGUAGES` (`i18n/mod.rs:14-20`). The array length `[LangInfo; 20]` must be bumped (`mod.rs:55`). For Korean, `uses_cjk()` already counts Hangul (`mod.rs:202-204`), but no bundled UI font covers Hangul on web (§5).
- Startup choice: the `language` setting defaults to `auto` (`lib.rs:258-259, 347`). `auto` follows env `WORDCRAFT_LANGUAGE` first, then `sys_locale::get_locales()`, which is the browser's `navigator.languages` on wasm (`i18n/mod.rs:287-294`; `crates/ui-egui/Cargo.toml` `sys-locale … features=["js"]`). The `ui.language` command (`lib.rs:1387-1395`) is session-only on web. The region (paper, units, decimal separator) comes from the browser locale (`web.rs:56-58`; `i18n/mod.rs:300-307`).
- Key counts (non-comment lines): vi 2568, it 2560, hu 2555, bg 2545, cs/pl 2544, es 2511, ru/tr 2530, et 2188, fr 2173, and de/ja/pt-br/sr/sr-latn/uk/zh-hans/zh-hant 2162 each. I did not determine the total number of distinct `tl!()` source keys.

## 5. Fonts

- Always embedded (both targets): 13 OFL faces in `FontDb` `BUNDLED` (`crates/fonts/src/fontdb.rs:27-41`): Source Sans 3 ×4, Source Serif 4 ×5, Inter ×3, JetBrains Mono. Total about 4.3 MB of TTF (`assets/fonts`).
- **Possible duplicates:** `crates/ui-egui/src/theme.rs:452-456` includes Inter-Regular/Medium/SemiBold, SourceSans3-Regular and JetBrainsMono again via `include_bytes!` (about 1.95 MB). I did not measure whether LLVM merges identical constants.
- `crates/fonts/build.rs`: optional `CRAFT_FONTS_DIR` checkout (`build.rs:1-7, 15-33`). **On wasm32 only "BIZ UDPGothic Regular" is embedded** (`build.rs:50, 58-60`). Native release builds require the Jpan and Hans scripts (`build.rs:41-43`). Without the variable, `CRAFT_FONTS` is empty.
- Fallback on wasm: no system fonts (`fontdb.rs:706-710`), and system fallback search returns nothing (`fontdb.rs:1465-1468`). Fallback chooses only among loaded faces (`fontdb.rs:1393-1452`). So **Hangul has no glyph source on web** unless the document embeds a font or the user adds one **(unverified visually)**.
- **Runtime font loading exists:** File › Options › Add Font picks TTF/OTF/TTC/WOFF/WOFF2, up to 50 MB (`crates/fonts/src/fontdb/user.rs:1-11, 22-23, 222`). On web the bytes go to IndexedDB `wordcraft/fonts` and are reloaded at startup (`apps/wordcraft-web/src/web/font_store.rs:89-116`; `web.rs:48-50, 205-206`). Fonts embedded in DOCX are also loaded on open (`crates/engine/src/io.rs:166`; `fontdb/user.rs:250`). So fonts *could* be served as separate files, but no code fetches fonts from a URL. A host would need to add a fetch that calls `FontDb::global().install_font` (see the pattern in `font_store.rs:104`).
- Math: no bundled OpenType MATH font. Desktop resolves system math fonts (`crates/fonts/src/math.rs:349-356` is a desktop-only test), so equation rendering on web may be degraded **(unverified)**.

## 6. Command groups (ribbon/menu)

Source of truth: `crates/engine/src/catalog.rs` (`Tab|Group|Feature|command`) and the generated `docs/parity-checklist.md` (487 of 502 catalog features have commands, 97.0%). There are 628 distinct `CommandSpec::new` ids in engine and ui-egui and 122 default `.key(...)` shortcuts. "Has a command" does not mean feature-complete, and I did not exercise any of these.

| Group | Catalog lines | Web caveat |
|---|---|---|
| Character (font, size, B/I/U, double underline, strike, sub/sup, effects, highlight, color, shading, small/all caps, hidden, emboss, spacing/scale/position, border) | `catalog.rs:49-78` | — |
| Phonetic Guide (ruby), Enclose Characters | `catalog.rs:79-80`; ruby object `crates/engine/src/cmd/phonetic.rs:1-2` | — |
| Paragraph (align, distribute, spacing, indents, shading/borders, tabs, keep/widow, outline level, RTL/LTR, Asian Typography) | `catalog.rs:90-115` | — |
| Lists (bullets, numbering, multilevel, define, restart, set value) | `catalog.rs:81-89` | — |
| Styles (gallery, create/modify/delete, pane, inspector, manage) | `catalog.rs:116-129` | Templates & Add-ins / Organizer Browse disabled (`dialogs_templates.rs:55-58`) |
| Find/Replace/Go To/Advanced Find | `catalog.rs:130-139` | — |
| Tables (insert, draw, text↔table, quick tables, Table Design/Layout ×41) | `catalog.rs:145-149`; parity doc table rows | — |
| Pictures, shapes, icons, SmartArt, chart, drawing canvas, WordArt, ink (Draw tab) | `catalog.rs:150-160, 182, 194-202` | Online Pictures, 3D, Screenshot, Online Video, Ink-to-Math, Ink Equation missing everywhere (`docs/parity-checklist.md:40-60`). Pictures via picker, paste or drop on web (`web.rs:129-169`) |
| Text boxes | `catalog.rs:178` | ODT import drops them (§1) |
| Page setup, columns, breaks, sections, section RTL | `catalog.rs:216-229` | RTF export: one section only |
| Headers/footers, page numbers, different first/odd-even, link to previous | `catalog.rs:166-177` | — |
| Footnotes/endnotes | `catalog.rs:242-246` | lost in ODT/RTF |
| Equations | `catalog.rs:189`; Equation tab (21/22 live) | math font concern (§5) |
| TOC, captions, table of figures, index, table of authorities, cross-references | `catalog.rs:164, 238-261` | — |
| Citations/bibliography (built-in, 10 styles) | `catalog.rs:248-251`; `crates/engine/src/cmd/citations.rs:1-3` | — |
| Zotero | `crates/zotero/src/lib.rs:1-8` (127.0.0.1:23116) | **Desktop only**: `crates/ui-egui/src/zotero.rs:90-93`; buttons disabled `widgets.rs:100` |
| Track changes, markup, reviewing pane, accept/reject | `catalog.rs` Review › Tracking/Changes (~lines 296-306) | — |
| Comments (new/delete/reply/resolve) | `catalog.rs:165` + Review › Comments | lost in ODT |
| Compare / Combine | Review › Compare | **"another file" disabled on web** (`dialogs_review.rs:193-195`); `text` param only |
| Restrict Editing (readOnly/comments/trackedChanges/forms + password) | `crates/engine/src/cmd/protect.rs:1-8, 18, 22-24` | Document-level setting. There is no URL or host flag for a read-only viewer |
| Mail merge (recipients CSV/TSV/xlsx/xls/ods, fields, rules, preview, finish), envelopes, labels | `catalog.rs:263-~283` | Recipients via picker purpose `recipients` (`web.rs:183-184`; `lib.rs:1584-1592`) |
| Spelling/grammar | Review › Proofing | see §7 |
| Thesaurus | `crates/engine/src/cmd/review.rs:112, 901-902` | a tiny built-in English list |
| AutoCorrect (smart quotes, dashes, list autoformat, capitalisation) | `crates/engine/src/cmd/text.rs:51, 104-109` | — |
| Print / Print Markup / PDF | `catalog.rs:15-16` | Web: PDF into a hidden iframe, then `print()` (`web.rs:387-453`; `crates/ui-egui/src/printing.rs:161`) |
| Read Aloud | Review › Speech | **Fails on web**: "Read Aloud isn't available in the browser" (`crates/engine/src/speech.rs:396-404`) |
| Full screen | View | browser F11 only (`crates/engine/src/cmd/view.rs:123-126`) |
| Read Mode (view) | `catalog.rs` View › Views `view.readMode` | a view mode, not an edit lock |
| Keyboard shortcuts | 122 defaults; user remapping `crates/engine/src/keymap.rs:1-9` | Remapping is not persisted on web (§3) |

## 7. Proofing on wasm

- English: bundled Moby list (`assets/hyphenation/en-us.dic`, 433 KB, `crates/proof/src/hyphen.rs:30`) plus `en-extra.txt` (`proof/src/lib.rs:286`). This works on web.
- Polish, Portuguese, Italian, Russian, Turkish and Croatian spelling need **system Hunspell** dictionaries. The web returns no search dirs (`crates/proof/src/hunspell.rs:10, 47-49`), and the module docs say the dictionaries are not bundled (`proof/src/lib.rs:10-30`; `tr/mod.rs:3-6`; `hr/mod.rs:1-2`). So the web has **English spelling only**. Rule-based grammar and hyphenation for those languages is code or bundled patterns (`assets/hyphenation/{pl,pt,it}.pat`) and probably still runs **(unverified)**. Korean has no proofing at all (no `ProofLang` for it).

## 8. Clipboard, IME, East Asian

- Text copy/paste goes through eframe. The internal copy keeps a rich `Fragment` in the session (`crates/engine/src/session.rs:349-356`; `cmd/paste.rs:4-8`).
- On web **no HTML/RTF clipboard read or write**: those `Services` hooks (`clipboard_html`, `set_clipboard_html`, `clipboard_rtf`, `clipboard_formats`) are desktop-only (`crates/ui-egui/src/lib.rs:141-153`) and not set in `web.rs:172-209`. Formatting pasted from Word or a web page arrives as plain text **(inferred)**.
- Pictures can be pasted through a `paste` listener (`web.rs:129-169`), up to 200 MB and 20 pictures.
- IME: handles egui `ImeEvent::Preedit/Commit` (`crates/ui-egui/src/keys.rs:290-295, 317-322`) and IME output position (`canvas.rs:1239, 1281`). **Korean IME behaviour in eframe's web text agent was not tested.**
- East Asian layout: character grid, `w:eastAsia` fonts (`crates/layout/src/para.rs:449, 664, 764`), ruby (§6), Asian Typography paragraph options. Table cell vertical text only (`crates/engine/src/cmd/table.rs:105, 461-463`).

## 9. Embedding and host bridge

- **WordCraft has no parent/host bridge.** `rg postMessage` finds nothing in `apps/wordcraft-web`, and there is no `host.rs`. Its only URL flags are `?webgl` and `?sample` (`web.rs:9`).
- GridCraft has one: `source/gridcraft/apps/gridcraft-web/src/host.rs:1-14` (`?host=parent`; messages `ready`/`open`/`save`/`dirty`/`failed`; same-origin only; `?author=`).
- WordCraft's `Services` has the same seams (`download`, `inbox`, `on_dirty`: `crates/ui-egui/src/lib.rs:93-127`), so porting `host.rs` looks mechanical, but it would be our own patch.
- No JS-callable API (`#[wasm_bindgen]` exports) exists.

## 10. Automation and AI

- MCP server (`crates/mcp/src/lib.rs:1-5`; `docs/mcp.md`) and CLI (`apps/wordcraft-cli/src/main.rs`) run headless or over the desktop app's TCP control channel. **Neither is in the web build** (`web.rs:7` "no TCP control channel"; the web Cargo deps do not include mcp).
- AI: none. There are no LLM or HTTP clients (`rg openai|anthropic|reqwest|ureq` finds 0 hits). "Translate" and "Dictate" are unimplemented (`docs/parity-checklist.md`).

## 11. Licence and brand

- Code: MIT OR Apache-2.0 (`Cargo.toml` workspace `license`; `LICENSE-MIT`, `LICENSE-APACHE`).
- `NOTICE` lists:
  - OFL 1.1 fonts (Source Sans 3, Source Serif 4, Inter, JetBrains Mono; craft-fonts BIZ UD*/Shippori when built with them)
  - Moby word list (public domain)
  - en-us.pat (CC0)
  - pl.pat (MIT)
  - pt.pat (**BSD-3-Clause**, notice must be reproduced in binary distributions)
  - it.pat (MIT option of LPPL/MIT)
  - encoding_rs ((Apache-2.0 OR MIT) AND BSD-3-Clause; noted in `Cargo.toml` comments)
- Git dependency `craft-ui` (storytold/craft-libs `d27646a`) is MIT OR Apache-2.0 (local cargo checkout `Cargo.toml:8`).
- Brand: `docs/brand/LICENSE-brand.txt` makes the ArtCraft name and marks non-open. **A modified or forked distribution must remove the ArtCraft marks** and must not present itself as ArtCraft. The brand image files are not referenced by code, but the ArtCraft name appears in the UI: About dialog (`crates/ui-egui/src/dialogs.rs:2656-2664`), Discord button (`crates/ui-egui/src/chrome.rs:307`; `lib.rs:1469`). The WordCraft app icon is MIT/Apache (`ATTRIBUTION.md:18-33`).

## Not determined

- Real WASM size, and whether duplicate `include_bytes!` fonts are merged.
- Whether Korean IME, Korean rendering after adding a font, encrypted-file prompts, mail-merge Finish, equation rendering and print work in a browser. Nothing was run.
- The total number of distinct UI strings, so per-language coverage percentages.
- Whether `docs/file-format-parity.md`'s contradictory rows on encrypted `.doc` (lines ~37-40 vs the docbin `crypt.rs` reader) reflect current behaviour. The code reads XOR/RC4.
