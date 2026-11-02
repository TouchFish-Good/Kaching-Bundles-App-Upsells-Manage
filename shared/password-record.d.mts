export function createPasswordRecord(password: string): Promise<string>;
export function verifyPasswordRecord(record: string, password: string): Promise<boolean>;
