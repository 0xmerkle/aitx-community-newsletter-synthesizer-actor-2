export function removeEmDashes(text: string): string {
    return text.replace(/\u2014/g, '-').replace(/\u2013/g, '-');
}
