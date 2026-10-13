// Korean labels for the svelte-pdf-mini parts we use (the library defaults to English).
// Keys missing here fall back to the library's English text.
import { defaultPalette } from 'svelte-pdf-mini';

const colorNames: Record<string, string> = { yellow: '노랑', green: '초록', blue: '파랑', red: '빨강' };
/** The annotation colors offered, with Korean names. */
export const palette = defaultPalette.filter(color => color.key in colorNames).map(color => ({ ...color, label: colorNames[color.key] }));

export const messages = {
    zoom: '배율', zoomIn: '확대', zoomOut: '축소', zoomAuto: '자동', zoomPageWidth: '쪽 너비', zoomPageHeight: '쪽 높이', zoomPageFit: '쪽 전체',
    page: '{page}쪽', pages: '쪽', pageInput: '쪽 (1–{count})', prevPage: '이전 쪽', nextPage: '다음 쪽', back: '뒤로', backToPage: '{page}쪽으로 돌아가기',
    find: '문서에서 찾기', findNext: '다음 결과', findPrev: '이전 결과', findNoResults: '결과 없음', matchCase: '대소문자 구분', wholeWords: '단어 단위', regex: '정규식', matchAccents: '악센트 구분',
    outline: '목차', toc: '목차',
    passwordNeeded: '암호로 보호된 PDF입니다', passwordIncorrect: '암호가 틀렸습니다. 다시 입력하세요', passwordOpen: '열기',
    copy: '복사', copyText: '텍스트 복사', undo: '실행 취소', redo: '다시 실행', delete: '삭제', color: '색', annotation: '주석',
    underline: '밑줄', strikeout: '취소선', highlight: '형광펜', comment: '메모', addNote: '메모 추가…', editNote: '메모 편집',
    tool_select: '선택', tool_hand: '이동', tool_highlight: '형광펜', tool_underline: '밑줄', tool_strikeout: '취소선', tool_note: '메모', tool_ink: '펜', tool_rect: '사각형',
    annotateSelection: '선택한 글에 주석', highlightColor: '형광펜 {color}', label: '이름표', changeType: '종류 바꾸기', markupStyle: '모양', reply: '답글',
    annotationsOnPage: '{page}쪽 주석', annotationMarkers: '{page}쪽 주석 표시', annotationNote: '메모: {note}',
    pendingKeep: '유지', pendingDiscard: '버리기', pendingColor: '색',
    kind_highlight: '형광펜', kind_underline: '밑줄', kind_strikeout: '취소선', kind_note: '메모', kind_ink: '펜', kind_rect: '사각형', kind_other: '주석',
    announceCreated: '{kind}을(를) 만들었습니다. 메모를 입력하고 Enter로 유지, Escape로 버립니다.',
    announceDeleted: '주석을 지웠습니다', announceDeletedMany: '주석 {count}개를 지웠습니다', announceDiscarded: '버렸습니다', announceOverlap: '겹친 주석 {count}개 중 {index}번째',
};
