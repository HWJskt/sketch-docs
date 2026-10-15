// A small XML reader for the parts of an .xlsx package (src/xlsx/compare.ts). It runs where DOMParser does
// not (a worker, Node), and reads well-formed XML only: anything else throws. Element and attribute names
// keep their prefix in `name` and drop it in `local`, since packages may write `x:row` or plain `row`.
export interface XmlElement {
    name: string;
    local: string;
    attrs: Record<string, string>;
    children: XmlElement[];
    /** The element's own character data (text and CDATA directly inside it), entities decoded. */
    text: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const local = (name: string) => name.slice(name.indexOf(':') + 1);
// A start tag at `lastIndex`: name, attributes (values may hold '>'), and '/' when it closes itself.
const START = /<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;

export function decode(text: string): string {
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, entity: string) => {
        if (entity[0] === '#') {
            const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
            return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }
        if (!(entity in ENTITIES)) throw new Error(`Unknown XML entity &${entity};`);
        return ENTITIES[entity];
    });
}

export function parseXml(source: string): XmlElement {
    const root: XmlElement = { name: '#document', local: '#document', attrs: {}, children: [], text: '' };
    const stack: XmlElement[] = [root];
    let at = 0;
    const fail = (why: string): never => { throw new Error(`XML: ${why} at ${at}`); };
    while (at < source.length) {
        const open = source.indexOf('<', at);
        if (open < 0) { stack[stack.length - 1].text += decode(source.slice(at)); break; }
        if (open > at) stack[stack.length - 1].text += decode(source.slice(at, open));
        at = open;
        if (source.startsWith('<?', at)) { const end = source.indexOf('?>', at); if (end < 0) fail('unclosed declaration'); at = end + 2; continue; }
        if (source.startsWith('<!--', at)) { const end = source.indexOf('-->', at); if (end < 0) fail('unclosed comment'); at = end + 3; continue; }
        if (source.startsWith('<![CDATA[', at)) {
            const end = source.indexOf(']]>', at);
            if (end < 0) fail('unclosed CDATA');
            stack[stack.length - 1].text += source.slice(at + 9, end);
            at = end + 3;
            continue;
        }
        if (source.startsWith('<!', at)) fail('a DOCTYPE is not accepted');
        if (source[at + 1] === '/') {
            const end = source.indexOf('>', at);
            if (end < 0) fail('unclosed end tag');
            const name = source.slice(at + 2, end).trim();
            const top = stack.pop();
            if (!top || top === root || top.name !== name) fail(`</${name}> does not close <${top?.name}>`);
            at = end + 1;
            continue;
        }
        START.lastIndex = at;
        const tag = START.exec(source);
        if (!tag) fail('bad start tag');
        const element: XmlElement = { name: tag![1], local: local(tag![1]), attrs: {}, children: [], text: '' };
        for (const attr of tag![2].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) element.attrs[attr[1]] = decode(attr[2] ?? attr[3]);
        stack[stack.length - 1].children.push(element);
        if (!tag![3]) stack.push(element);
        at += tag![0].length;
    }
    if (stack.length !== 1) fail(`<${stack[stack.length - 1].name}> is not closed`);
    if (root.children.length !== 1) fail('a document needs exactly one root element');
    return root.children[0];
}

/** An attribute by its name without prefix (`r:id` and `id` differ, so the exact name is tried first). */
export function attr(element: XmlElement | undefined, name: string): string | undefined {
    if (!element) return undefined;
    if (name in element.attrs) return element.attrs[name];
    for (const key in element.attrs) if (local(key) === name) return element.attrs[key];
    return undefined;
}
export const child = (element: XmlElement | undefined, name: string) => element?.children.find(c => c.local === name);
export const children = (element: XmlElement | undefined, name: string) => element?.children.filter(c => c.local === name) ?? [];
/** All character data under `element`, in document order (the text of a cell's rich runs). */
export function allText(element: XmlElement | undefined): string {
    if (!element) return '';
    return element.text + element.children.map(allText).join('');
}
