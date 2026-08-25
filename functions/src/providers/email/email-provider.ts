export type TransactionalEmailInput = {
  to: string;
  subject: string;
  html: string;
};

export type EmailResult = {
  provider: string;
  messageId?: string;
  status: "sent" | "skipped" | "failed";
};

export interface EmailProvider {
  sendTransactionalEmail(input: TransactionalEmailInput): Promise<EmailResult>;
}
