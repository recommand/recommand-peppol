/**
 * The OpenAPI tags of this package's routes, in the order a document lists them.
 * An application puts them in its document's `tags`, which describes each tag
 * where the operations only name it.
 */
export const tags: { description: string; name: string }[] = [
  {
    name: "Sending",
    description: "Endpoints for sending documents",
  },
  {
    name: "Reporting",
    description:
      "French e-reporting: register a company as a declarant, then submit the daily B2C totals and cross-border invoices that Recommand reports to the French tax administration on its behalf. Available for companies registered in France.",
  },
  {
    name: "Recipients",
    description:
      "Interaction with the Peppol directory. For now, this always returns results from the production Peppol directory, even in playground teams.",
  },
  {
    name: "Documents",
    description: "Endpoints for managing documents.",
  },
  {
    name: "Companies",
    description:
      "You can manage all companies for a team. Each business you want to send or receive Peppol documents for needs to be registered as a company.",
  },
  {
    name: "Company Identifiers",
    description:
      "You can manage all Peppol identifiers for a company. Peppol identifiers are used to identify a company in the Peppol network. They are structured as scheme:identifier, e.g. '0208:1012081766' for the Belgian business with enterprise number 1012081766.",
  },
  {
    name: "Company Document Types",
    description:
      "You can manage all Peppol document types for a company. Peppol document types are used to identify the type of document that can be received by a company.",
  },
  {
    name: "Company Notification Email Addresses",
    description:
      "You can manage all notification email addresses for a company. Notification email addresses are used to receive notifications when a document is received or sent by a company.",
  },
  {
    name: "Webhooks",
    description:
      "Configure webhook endpoints that receive document and company events in real time.",
  },
  {
    name: "Playgrounds",
    description:
      "Endpoints for working with playgrounds. Playgrounds are used to test the Recommand API without affecting production data or communicating over the Peppol network. A new playground can be created via the Recommand dashboard by clicking the team switcher in the top left, or via the API outlined below. Usage of the playground is free.",
  },
  {
    name: "Labels",
    description:
      "You can manage all labels for a team. Labels are used to organize and categorize your data.",
  },
  {
    name: "Suppliers",
    description:
      "You can manage all suppliers (supporting data) for a team. Suppliers are used to organize and categorize your supporting data.",
  },
  {
    name: "Customers",
    description:
      "You can manage all customers (supporting data) for a team. Customers are used to quickly fill in buyer information when sending documents.",
  },
  {
    name: "Integrations",
    description:
      "You can manage all activated integrations for a team. Integrations allow you to connect external services and automate workflows.",
  },
];
