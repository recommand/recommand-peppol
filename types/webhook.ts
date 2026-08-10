export type Webhook = {
  id: string;
  teamId: string;
  companyId: string | null;
  url: string;
  secret: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type WebhookFormData = {
  url: string;
  companyId?: string | null;
  secret?: string | null;
};

export const defaultWebhookFormData: WebhookFormData = {
  url: "",
  companyId: undefined,
  secret: undefined,
}; 
