import { offlineReady } from './offline';
const frame = document.createElement('iframe');
frame.title = 'Word 문서 편집기';
frame.src = './engines/word/index.html';
frame.style.cssText = 'width:100%;height:100dvh;border:0;display:block';
frame.allow = 'clipboard-read; clipboard-write';
void offlineReady.then(() => document.getElementById('app')!.append(frame));
