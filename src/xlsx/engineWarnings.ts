// The engine's warnings on opening an .xlsx come in English (GridCraft crates/xlsx, read report). They are
// shown in Korean; one not in this list is shown as the engine said it, after a Korean lead-in. The list is
// every warning the .xlsx reader can give at the pinned engine (`d9d09f0`: read.rs, sheet_read.rs, drawing.rs,
// pivot.rs, passthrough.rs, richdata.rs); tests/xlsx-losses.test.mjs checks it against that source when present.
type Rule = [RegExp, (...groups: string[]) => string];
const q = (name: string) => `"${name}"`;
const RULES: Rule[] = [
    // drawing.rs
    [/^a linked \(not embedded\) picture was skipped$/, () => '연결된(포함되지 않은) 그림을 건너뛰었습니다.'],
    [/^missing picture (.+)$/, part => `그림 파일이 없습니다(${part}).`],
    [/^chart (.+) has no supported plot and was skipped$/, part => `지원하지 않는 형태의 차트를 건너뛰었습니다(${part}).`],
    [/^a histogram, waterfall, treemap… chart without its chart part was skipped$/, () => '히스토그램·폭포·트리맵 등 새 형식 차트를 건너뛰었습니다.'],
    [/^an embedded object \(SmartArt, OLE…\) was skipped$/, () => '포함된 개체(SmartArt·OLE 등)를 건너뛰었습니다.'],
    [/^grouped shapes are not supported and were skipped$/, () => '그룹 도형은 지원하지 않아 건너뛰었습니다.'],
    // pivot.rs
    [/^(.+) is not a pivot cache definition; its PivotTable was kept as plain cells$/, part => `피벗 테이블 캐시가 아닌 부분이 있어(${part}) 피벗 테이블을 일반 셀로 남겼습니다.`],
    [/^PivotTables with a (.+) data source are not supported; kept as plain cells$/, type => `원본 형식이 ${type}인 피벗 테이블은 지원하지 않아 일반 셀로 남겼습니다.`],
    [/^a PivotTable's source is in another workbook; its source reference may not resolve$/, () => '피벗 테이블의 원본이 다른 통합 문서에 있어 원본 참조가 맞지 않을 수 있습니다.'],
    [/^a PivotTable's source reference is missing or invalid; kept as plain cells$/, () => '피벗 테이블의 원본 참조가 없거나 잘못되어 일반 셀로 남겼습니다.'],
    [/^a PivotTable's cache has no worksheet source; kept as plain cells$/, () => '피벗 테이블 캐시에 워크시트 원본이 없어 일반 셀로 남겼습니다.'],
    [/^a PivotTable's cache has no fields; kept as plain cells$/, () => '피벗 테이블 캐시에 필드가 없어 일반 셀로 남겼습니다.'],
    [/^(.+) is not a PivotTable definition; skipped$/, part => `피벗 테이블 정의가 아닌 부분을 건너뛰었습니다(${part}).`],
    [/^PivotTable in (.+) has no cache; kept as plain cells$/, part => `캐시가 없는 피벗 테이블을 일반 셀로 남겼습니다(${part}).`],
    [/^calculated PivotTable fields are not supported$/, () => '피벗 테이블 계산 필드는 지원하지 않습니다.'],
    [/^PivotTable grouping of "(.+)" is not supported; the field is ungrouped$/, field => `피벗 테이블 필드 ${q(field)}의 그룹은 지원하지 않아 그룹을 풀었습니다.`],
    [/^PivotTable field "(.+)" \(grouped items\) is not supported$/, field => `피벗 테이블 필드 ${q(field)}(그룹 항목)는 지원하지 않습니다.`],
    [/^PivotTable "(.+)" has no valid location; kept as plain cells$/, table => `피벗 테이블 ${q(table)}의 위치가 잘못되어 일반 셀로 남겼습니다.`],
    [/^PivotTable "(.+)": calculated items and label\/value filters are not supported$/, table => `피벗 테이블 ${q(table)}: 계산 항목과 레이블·값 필터는 지원하지 않습니다.`],
    [/^PivotTable function (.+) is not supported; using Sum$/, fn => `피벗 테이블 함수 ${fn}은(는) 지원하지 않아 합계로 계산합니다.`],
    [/^PivotTable show-values-as (.+) is not supported$/, how => `피벗 테이블 값 표시 형식 ${how}은(는) 지원하지 않습니다.`],
    // read.rs
    [/^skipped (.+?): (.*)$/, (part, why) => `읽지 못한 부분을 건너뛰었습니다(${part}${why ? `: ${why}` : ''}).`],
    [/^cell-picture data could not be read \((.*)\); scalar fallbacks were retained$/, why => `셀 안 그림 데이터를 읽지 못해 대체 값을 남겼습니다(${why}).`],
    [/^no styles part$/, () => '서식 정보가 없습니다.'],
    [/^shared strings are damaged \((.*)\); kept (\d+) strings$/, (why, n) => `공유 문자열이 손상되어 ${n}개만 남겼습니다(${why}).`],
    [/^missing part (.+)$/, part => `파일 안의 부분이 없습니다(${part}).`],
    [/^sheet "(.+)" has no part; skipped$/, sheet => `시트 ${q(sheet)}의 내용이 없어 건너뛰었습니다.`],
    [/^sheet "(.+)" is a (.+) and was skipped$/, (sheet, kind) => `시트 ${q(sheet)}는 워크시트가 아니라(${kind}) 건너뛰었습니다.`],
    [/^sheet "(.+)" could not be read: (.*)$/, (sheet, why) => `시트 ${q(sheet)}를 읽지 못했습니다(${why}).`],
    [/^PivotTables on sheet "(.+)" could not be read: (.*)$/, (sheet, why) => `시트 ${q(sheet)}의 피벗 테이블을 읽지 못했습니다(${why}).`],
    [/^the workbook has no worksheets; added an empty sheet$/, () => '워크시트가 없어 빈 시트를 더했습니다.'],
    [/^macros \(VBA project\) were kept but not executed$/, () => '매크로(VBA)는 실행하지 않았습니다. .xlsx로 저장하면 매크로는 빠집니다.'],
    [/^macros \(VBA project\) reference a missing part and were dropped$/, () => '매크로(VBA)가 없는 부분을 가리켜 뺐습니다.'],
    [/^macros \(VBA project\) could not be read and were dropped: (.*)$/, why => `매크로(VBA)를 읽지 못해 뺐습니다(${why}).`],
    // sheet_read.rs
    [/^sheet "(.+)" is damaged \((.*)\); kept (\d+) rows$/, (sheet, why, n) => `시트 ${q(sheet)}가 손상되어 ${n}행만 남겼습니다(${why}).`],
    [/^sheet "(.+)": (\d+) cells or rows outside the 1,048,576 × 16,384 grid were dropped$/, (sheet, n) => `시트 ${q(sheet)}: 표 범위(1,048,576행 × 16,384열) 밖의 셀·행 ${n}개를 뺐습니다.`],
    [/^some cells refer to missing shared strings$/, () => '일부 셀이 없는 공유 문자열을 가리킵니다.'],
    [/^some date cells could not be read$/, () => '일부 날짜 셀을 읽지 못했습니다.'],
    [/^some numeric cells could not be read$/, () => '일부 숫자 셀을 읽지 못했습니다.'],
    [/^some cells have unsupported or missing value metadata; kept their scalar fallback \(cell pictures may be missing\)$/, () => '일부 셀의 값 정보를 지원하지 않거나 없어 대체 값을 남겼습니다(셀 안 그림이 빠질 수 있음).'],
    [/^formula-generated cell pictures were imported as static pictures; their formulas were not retained$/, () => '수식으로 만든 셀 안 그림을 고정 그림으로 가져왔습니다. 수식은 남지 않습니다.'],
    [/^a shared formula refers to a missing master cell; kept the cached value$/, () => '공유 수식의 기준 셀이 없어 저장된 값을 남겼습니다.'],
    [/^what-if data tables are not supported; kept their values$/, () => '가상 분석 데이터 표는 지원하지 않아 값만 남겼습니다.'],
    [/^conditional format type "(.+)" is not supported$/, type => `조건부 서식 종류 ${q(type)}는 지원하지 않습니다.`],
    [/^sheet "(.+)": hyperlinks past the first (\d+) cells were dropped$/, (sheet, n) => `시트 ${q(sheet)}: 처음 ${n}개 셀 뒤의 하이퍼링크를 뺐습니다.`],
    [/^date filters in AutoFilters are not supported$/, () => '자동 필터의 날짜 필터는 지원하지 않습니다.'],
    [/^some Excel 2010 conditional format extensions were skipped$/, () => 'Excel 2010 조건부 서식 확장 일부를 건너뛰었습니다.'],
    // passthrough.rs
    [/^chart sheet "(.+)" was skipped and is not kept on save$/, sheet => `차트 시트 ${q(sheet)}를 건너뛰었고 저장하면 빠집니다.`],
    [/^unmodelled content of a Strict Open XML workbook \(custom XML, links, controls…\) is not kept on save$/, () => 'Strict Open XML 통합 문서의 일부 내용(사용자 XML·연결·컨트롤 등)은 저장하면 빠집니다.'],
    [/^links to external workbooks were kept; they are not followed or refreshed$/, () => '다른 통합 문서와의 연결은 남겼지만 따라가거나 새로 고치지 않습니다.'],
    [/^links to external workbooks were dropped: (.*)$/, why => `다른 통합 문서와의 연결을 뺐습니다(${why}).`],
    [/^chart sheet "(.+)" was dropped: (.*)$/, (sheet, why) => `차트 시트 ${q(sheet)}를 뺐습니다(${why}).`],
    [/^sheet "(.+)": relationships could not be read \((.*)\); unmodelled content was dropped$/, (sheet, why) => `시트 ${q(sheet)}: 연결 정보를 읽지 못해 일부 내용을 뺐습니다(${why}).`],
    [/^sheet "(.+)": controls and embedded objects could not be read and were dropped$/, sheet => `시트 ${q(sheet)}: 컨트롤과 포함된 개체를 읽지 못해 뺐습니다.`],
    [/^sheet "(.+)": printer settings were dropped: (.*)$/, (sheet, why) => `시트 ${q(sheet)}: 프린터 설정을 뺐습니다(${why}).`],
    [/^sheet "(.+)": controls and embedded objects were dropped: (.*)$/, (sheet, why) => `시트 ${q(sheet)}: 컨트롤과 포함된 개체를 뺐습니다(${why}).`],
    [/^sheet "(.+)": embedded objects and form controls are not shown; they are kept for saving$/, sheet => `시트 ${q(sheet)}: 포함된 개체와 양식 컨트롤은 보이지 않지만 저장할 때 남깁니다.`],
    [/^sheet "(.+)": (.+) were dropped: (.*)$/, (sheet, slot, why) => `시트 ${q(sheet)}: ${slot}을(를) 뺐습니다(${why}).`],
    [/^sheet "(.+)": (.+) was dropped: (.*)$/, (sheet, kind, why) => `시트 ${q(sheet)}: ${kind}을(를) 뺐습니다(${why}).`],
    [/^(.+) part (.+) was dropped: (.*)$/, (kind, part, why) => `${kind} 부분 ${part}을(를) 뺐습니다(${why}).`],
    [/^(.+) was dropped: (.*)$/, (kind, why) => `${kind}을(를) 뺐습니다(${why}).`],
    // richdata.rs
    [/^external (.+) relationship is unsupported; cell pictures may be missing$/, kind => `외부 ${kind} 연결은 지원하지 않아 셀 안 그림이 빠질 수 있습니다.`],
    [/^conflicting (.+) relationships; cell pictures may be missing$/, kind => `${kind} 연결이 서로 맞지 않아 셀 안 그림이 빠질 수 있습니다.`],
    [/^missing or damaged cell-picture part (.+?): (.*)$/, (part, why) => `셀 안 그림 부분이 없거나 손상되었습니다(${part}${why ? `, ${why}` : ''}).`],
    [/^invalid cell-picture part (.+)$/, part => `셀 안 그림 부분이 잘못되었습니다(${part}).`],
    [/^cell-picture (.+) count does not match its records$/, name => `셀 안 그림 ${name}의 개수가 기록과 맞지 않습니다.`],
    [/^duplicate XLRICHVALUE metadata types; cell pictures were not loaded$/, () => '셀 안 그림 정보가 중복되어 그림을 불러오지 않았습니다.'],
    [/^missing rich-value data relationship; cell pictures were not loaded$/, () => '셀 안 그림 데이터 연결이 없어 그림을 불러오지 않았습니다.'],
    [/^missing rich-value structure or image relationships; cell pictures were not loaded$/, () => '셀 안 그림 구조나 이미지 연결이 없어 그림을 불러오지 않았습니다.'],
    [/^some rich values are unsupported or malformed; their scalar fallbacks were retained \(cell pictures may be missing\)$/, () => '일부 셀 안 그림 값을 지원하지 않거나 잘못되어 대체 값을 남겼습니다(셀 안 그림이 빠질 수 있음).'],
    [/^missing XLRICHVALUE future metadata; cell pictures were not loaded$/, () => '셀 안 그림 정보가 없어 그림을 불러오지 않았습니다.'],
    [/^a cell picture has an external or invalid image relationship; kept its scalar fallback$/, () => '셀 안 그림의 이미지 연결이 외부이거나 잘못되어 대체 값을 남겼습니다.'],
    [/^missing, damaged or oversized cell picture (.+?): (.*); kept its scalar fallback$/, part => `셀 안 그림이 없거나 손상되었거나 너무 커서 대체 값을 남겼습니다(${part}).`],
    [/^a cell picture is not a supported PNG\/JPEG or exceeds 8192 pixels per side \/ 16 million pixels; kept its scalar fallback$/, () => '셀 안 그림이 지원하는 PNG·JPEG가 아니거나 너무 커서(한 변 8192픽셀·1,600만 픽셀 초과) 대체 값을 남겼습니다.'],
    [/^cell pictures exceed the 128 MiB workbook limit; remaining pictures kept their scalar fallbacks$/, () => '셀 안 그림이 통합 문서 한도(128 MiB)를 넘어 나머지는 대체 값으로 남겼습니다.'],
];

/** The warning in Korean, or null when it is not one this list knows. */
export function knownWarning(text: string): string | null {
    for (const [pattern, say] of RULES) {
        const match = pattern.exec(text.trim());
        if (match) return say(...match.slice(1));
    }
    return null;
}
/** For the screen: Korean, or an unknown warning as the engine said it. */
export const warningText = (text: string) => knownWarning(text) ?? `엔진 알림(번역 없음): ${text}`;
