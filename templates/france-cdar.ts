export const FRANCE_CDAR_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charSet="utf-8" />
    <title>{{documentTypeLabel}} {{responseId}}</title>
    <style>
      /* Tailwind preflight is injected by the Tailwind PDF generator */
      body { margin: 0; padding: 0; }
    </style>
  </head>
  <body class="bg-slate-100 text-slate-900">
    <div class="max-w-3xl mx-auto my-8 bg-white shadow-sm rounded-lg overflow-hidden">
      <div class="px-8 pt-8 pb-4 border-b border-slate-200">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500">
              {{documentTypeLabel}}
            </p>
            <h1 class="mt-1 text-2xl font-semibold tracking-tight">
              {{responseId}}
            </h1>
            <p class="mt-2 text-xs text-slate-500 space-x-2">
              <span>Issue date: {{issueDate}}</span>
              <span>&bull;</span>
              <span>{{phaseLabel}} ({{phase}})</span>
              <span>&bull;</span>
              <span>{{businessProcess}}</span>
            </p>
          </div>
        </div>
      </div>

      <div class="px-8 py-6 space-y-6">
        <div>
          <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Status</p>
          <div class="flex items-center gap-3">
            <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium
              {{#isPositive}}bg-green-100 text-green-800{{/isPositive}}
              {{#isNegative}}bg-red-100 text-red-800{{/isNegative}}
              {{#isWarning}}bg-amber-100 text-amber-800{{/isWarning}}
              {{#isInfo}}bg-blue-100 text-blue-800{{/isInfo}}">
              {{statusCode}}
            </span>
            <span class="text-sm text-slate-700">{{statusCodeLabel}}</span>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-6 text-sm">
          <div>
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Sender</p>
            <p class="text-slate-700">Role: {{senderRoleLabel}} ({{senderRole}})</p>
          </div>
          <div>
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Issuer</p>
            <p class="text-slate-700">Role: {{issuerRoleLabel}} ({{issuerRole}})</p>
            {{#issuerLegalId}}
              <p class="text-slate-700 font-mono break-all mt-1">{{issuerLegalIdScheme}}:{{issuerLegalId}}</p>
            {{/issuerLegalId}}
          </div>
          <div>
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Recipient</p>
            <p class="text-slate-700">Role: {{recipientRoleLabel}} ({{recipientRole}})</p>
            {{#recipientLegalId}}
              <p class="text-slate-700 font-mono break-all mt-1">{{recipientLegalIdScheme}}:{{recipientLegalId}}</p>
            {{/recipientLegalId}}
            {{#recipientElectronicAddress}}
              <p class="text-slate-700 font-mono break-all mt-1">{{recipientElectronicAddressScheme}}:{{recipientElectronicAddress}}</p>
            {{/recipientElectronicAddress}}
          </div>
        </div>

        <div>
          <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Referenced invoice</p>
          <dl class="grid grid-cols-1 gap-3 text-sm">
            <div>
              <dt class="text-xs text-slate-500">Invoice number</dt>
              <dd class="text-slate-700 font-mono break-all">{{invoiceId}}</dd>
            </div>
            {{#invoiceIssueDate}}
              <div>
                <dt class="text-xs text-slate-500">Invoice issue date</dt>
                <dd class="text-slate-700">{{invoiceIssueDate}}</dd>
              </div>
            {{/invoiceIssueDate}}
            {{#sellerLegalId}}
              <div>
                <dt class="text-xs text-slate-500">Seller legal ID</dt>
                <dd class="text-slate-700 font-mono break-all">{{sellerLegalIdScheme}}:{{sellerLegalId}}</dd>
              </div>
            {{/sellerLegalId}}
          </dl>
        </div>

        {{#hasReason}}
          <div>
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Reason</p>
            {{#reasonCode}}
              <p class="text-sm text-slate-700 font-mono">{{reasonCode}}</p>
            {{/reasonCode}}
            {{#reason}}
              <p class="text-sm text-slate-700{{#reasonCode}} mt-1{{/reasonCode}}">{{reason}}</p>
            {{/reason}}
            {{#reasonNote}}
              <p class="text-sm text-slate-700 mt-1">{{reasonNote}}</p>
            {{/reasonNote}}
          </div>
        {{/hasReason}}

        {{#hasCollectedAmounts}}
          <div>
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Collected amounts</p>
            <ul class="space-y-1 text-sm text-slate-700">
              {{#collectedAmounts}}
                <li>{{amount}} {{currency}} (VAT {{vatPercent}}%)</li>
              {{/collectedAmounts}}
            </ul>
          </div>
        {{/hasCollectedAmounts}}
      </div>
    </div>
  </body>
</html>`;
