import { memberPermission, registerPermission } from "@core/lib/permissions";

// Every member could use these routes before they required a permission, so every member gets them
// OAuth clients can be granted most of them too. The ones that would give an app access that outlives the grant
// aren't offered to apps, and the ones that send something out start unticked, so a user grants them deliberately.
[
  { delegation: "all" as const, description: "Delete companies, and take them off the Peppol network", id: "exchange.companies.delete", name: "Delete companies", resource: "Companies" },
  { delegation: "all" as const, description: "See companies, and look up company data by VAT or enterprise number", id: "exchange.companies.read", name: "Read companies", resource: "Companies" },
  { delegation: "all" as const, description: "Create, change and verify companies", id: "exchange.companies.write", name: "Manage companies", resource: "Companies" },
  { delegation: "all" as const, description: "Remove customers the team sends documents to", id: "exchange.customers.delete", name: "Delete customers", resource: "Customers" },
  { delegation: "all" as const, description: "See the customers the team sends documents to", id: "exchange.customers.read", name: "Read customers", resource: "Customers" },
  { delegation: "all" as const, description: "Create and change customers the team sends documents to", id: "exchange.customers.write", name: "Manage customers", resource: "Customers" },
  { delegation: "all" as const, description: "Delete the document types a company receives", id: "exchange.document_types.delete", name: "Delete document types", resource: "Document types" },
  { delegation: "all" as const, description: "See the document types a company receives", id: "exchange.document_types.read", name: "Read document types", resource: "Document types" },
  { delegation: "all" as const, description: "Add and change the document types a company receives", id: "exchange.document_types.write", name: "Manage document types", resource: "Document types" },
  { delegation: "all" as const, description: "Delete documents, one at a time or all at once", id: "exchange.documents.delete", name: "Delete documents", resource: "Documents" },
  { delegation: "all" as const, description: "Download many documents at once", id: "exchange.documents.export", name: "Export documents", resource: "Documents" },
  { delegation: "all" as const, description: "Generate and preview documents without sending them", id: "exchange.documents.generate", name: "Generate documents", resource: "Documents" },
  { delegation: "all" as const, description: "Mark documents as read or unread, which takes them out of or back into the inbox", id: "exchange.documents.mark_as_read", name: "Mark documents as read", resource: "Documents" },
  { delegation: "all" as const, description: "See and download documents, and read the inbox", id: "exchange.documents.read", name: "Read documents", resource: "Documents" },
  // A sent document can't be called back, so a user lets an app send deliberately
  { delegation: "opt_in" as const, description: "Send documents over Peppol, or by email to recipients who aren't on Peppol", id: "exchange.documents.send", name: "Send documents", resource: "Documents" },
  { delegation: "all" as const, description: "Assign labels to documents and remove them", id: "exchange.documents.write", name: "Label documents", resource: "Documents" },
  { delegation: "all" as const, description: "Delete a company's Peppol identifiers", id: "exchange.identifiers.delete", name: "Delete identifiers", resource: "Identifiers" },
  // Holders also see a company's outbound migration keys, which move its identifier, and its incoming documents,
  // to another access point
  { delegation: "never" as const, description: "Move a Peppol identifier from another access point with its migration key", id: "exchange.identifiers.migrate", name: "Migrate identifiers", resource: "Identifiers" },
  { delegation: "all" as const, description: "See a company's Peppol identifiers and their migrations", id: "exchange.identifiers.read", name: "Read identifiers", resource: "Identifiers" },
  { delegation: "all" as const, description: "Add and change a company's Peppol identifiers", id: "exchange.identifiers.write", name: "Manage identifiers", resource: "Identifiers" },
  { delegation: "all" as const, description: "Delete integrations, which stops them syncing", id: "exchange.integrations.delete", name: "Delete integrations", resource: "Integrations" },
  // An integration holds the credentials of the team's accounting or ERP system, which keep working after the app
  // is disconnected
  { delegation: "never" as const, description: "See integrations and their task logs", id: "exchange.integrations.read", name: "Read integrations", resource: "Integrations" },
  // An integration gets tokens for the whole team, sent to the address the app chose, which keep
  // working after the app is disconnected
  { delegation: "never" as const, description: "Set up and change integrations, and reset their state; an integration can do everything integrations may, such as sending documents, changing customers and suppliers, and submitting e-reporting", id: "exchange.integrations.write", name: "Manage integrations", resource: "Integrations" },
  { delegation: "all" as const, description: "Delete labels, which removes them from documents and suppliers", id: "exchange.labels.delete", name: "Delete labels", resource: "Labels" },
  { delegation: "all" as const, description: "See the labels used to sort documents and suppliers", id: "exchange.labels.read", name: "Read labels", resource: "Labels" },
  { delegation: "all" as const, description: "Create and change labels", id: "exchange.labels.write", name: "Manage labels", resource: "Labels" },
  { delegation: "all" as const, description: "Delete the addresses a company's notifications go to", id: "exchange.notification_email_addresses.delete", name: "Delete notification email addresses", resource: "Notification email addresses" },
  { delegation: "all" as const, description: "See the addresses a company's notifications go to", id: "exchange.notification_email_addresses.read", name: "Read notification email addresses", resource: "Notification email addresses" },
  // An address keeps receiving the company's incoming documents after the app is disconnected
  { delegation: "opt_in" as const, description: "Add and change the addresses a company's notifications go to", id: "exchange.notification_email_addresses.write", name: "Manage notification email addresses", resource: "Notification email addresses" },
  { delegation: "all" as const, description: "See a company's French e-reporting declarant", id: "exchange.reporting.read", name: "Read e-reporting", resource: "E-reporting" },
  { delegation: "all" as const, description: "Submit French e-reporting to the tax authority", id: "exchange.reporting.submit", name: "Submit e-reporting", resource: "E-reporting" },
  { delegation: "all" as const, description: "Change a company's French e-reporting declarant", id: "exchange.reporting.write", name: "Manage e-reporting", resource: "E-reporting" },
  { delegation: "all" as const, description: "Remove suppliers the team receives documents from", id: "exchange.suppliers.delete", name: "Delete suppliers", resource: "Suppliers" },
  { delegation: "all" as const, description: "See the suppliers the team receives documents from", id: "exchange.suppliers.read", name: "Read suppliers", resource: "Suppliers" },
  { delegation: "all" as const, description: "Create and change suppliers, and label them", id: "exchange.suppliers.write", name: "Manage suppliers", resource: "Suppliers" },
  { delegation: "all" as const, description: "Delete webhooks, so their events are no longer delivered", id: "exchange.webhooks.delete", name: "Delete webhooks", resource: "Webhooks" },
  // A webhook's signing secret lets anyone sign deliveries to the team's endpoint as if they came from Recommand
  { delegation: "never" as const, description: "See webhooks and the addresses their events go to", id: "exchange.webhooks.read", name: "Read webhooks", resource: "Webhooks" },
  // A webhook keeps sending the team's events wherever the app pointed it
  { delegation: "opt_in" as const, description: "Create and change webhooks", id: "exchange.webhooks.write", name: "Manage webhooks", resource: "Webhooks" },
].forEach((permission) => registerPermission(memberPermission(permission)));
