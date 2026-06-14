export function hash(str: string): string { let h = 0; for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0 } return Math.abs(h).toString(16) }
