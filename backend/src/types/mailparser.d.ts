// Type declarations for mailparser
// Temporary fix until @types/mailparser is installed
declare module 'mailparser' {
  export interface ParsedMail {
    text?: string;
    html?: string;
    subject?: string;
    from?: any;
    to?: any;
    date?: Date;
    attachments?: any[];
  }

  export function simpleParser(source: any): Promise<ParsedMail>;
}
