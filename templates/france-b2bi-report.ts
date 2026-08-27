export const FRANCE_B2BI_REPORT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charSet="utf-8" />
    <title>{{documentTypeLabel}} {{reference}}</title>
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
              {{reference}}
            </h1>
            <p class="mt-2 text-xs text-slate-500 space-x-2">
              <span>{{reportTypeLabel}}</span>
              <span>&bull;</span>
              <span>{{dateLabel}}: {{date}}</span>
            </p>
          </div>
          <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium shrink-0
            {{#isSubmission}}bg-blue-100 text-blue-800{{/isSubmission}}
            {{#isCorrection}}bg-amber-100 text-amber-800{{/isCorrection}}
            {{#isCancellation}}bg-red-100 text-red-800{{/isCancellation}}">
            {{actionLabel}}
          </span>
        </div>
      </div>

      <div class="px-8 py-6 space-y-6">
        {{#isInvoice}}
          <div>
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Reported document</p>
            <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt class="text-xs text-slate-500">Document</dt>
                <dd class="text-slate-700">{{documentKindLabel}} {{documentNumber}}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">Issue date</dt>
                <dd class="text-slate-700">{{issueDate}}</dd>
              </div>
              {{#dueDate}}
                <div>
                  <dt class="text-xs text-slate-500">Due date</dt>
                  <dd class="text-slate-700">{{dueDate}}</dd>
                </div>
              {{/dueDate}}
              <div>
                <dt class="text-xs text-slate-500">Total excluding VAT</dt>
                <dd class="text-slate-700 font-medium">{{taxExclusiveAmount}} {{currency}}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">Total VAT</dt>
                <dd class="text-slate-700 font-medium">{{taxAmount}} {{currency}}</dd>
              </div>
            </dl>
          </div>

          <div>
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Buyer</p>
            <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt class="text-xs text-slate-500">Company number</dt>
                <dd class="text-slate-700">{{buyerScheme}}:{{buyerCompanyId}}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">Country</dt>
                <dd class="text-slate-700">{{buyerCountry}}</dd>
              </div>
              {{#buyerVatNumber}}
                <div>
                  <dt class="text-xs text-slate-500">VAT number</dt>
                  <dd class="text-slate-700">{{buyerVatNumber}}</dd>
                </div>
              {{/buyerVatNumber}}
            </dl>
          </div>

          <div>
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">VAT breakdown</p>
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th class="py-2 font-medium">VAT rate</th>
                  <th class="py-2 font-medium">Category</th>
                  <th class="py-2 font-medium text-right">Taxable amount</th>
                  <th class="py-2 font-medium text-right">VAT amount</th>
                </tr>
              </thead>
              <tbody>
                {{#invoiceVatBreakdown}}
                  <tr class="border-b border-slate-100">
                    <td class="py-2 text-slate-700">{{percentage}}%</td>
                    <td class="py-2 text-slate-700">
                      {{category}}{{#exemptionReason}} &mdash; {{exemptionReason}}{{/exemptionReason}}
                    </td>
                    <td class="py-2 text-slate-700 text-right">{{taxableAmount}} {{currency}}</td>
                    <td class="py-2 text-slate-700 text-right">{{taxAmount}} {{currency}}</td>
                  </tr>
                {{/invoiceVatBreakdown}}
              </tbody>
            </table>
          </div>
        {{/isInvoice}}

        {{#isPayment}}
          <div>
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Payment received</p>
            <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt class="text-xs text-slate-500">Invoice</dt>
                <dd class="text-slate-700">{{invoiceNumber}}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">Invoice issue date</dt>
                <dd class="text-slate-700">{{issueDate}}</dd>
              </div>
            </dl>
          </div>

          <div>
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th class="py-2 font-medium">VAT rate</th>
                  <th class="py-2 font-medium text-right">Amount including VAT</th>
                </tr>
              </thead>
              <tbody>
                {{#paymentVatBreakdown}}
                  <tr class="border-b border-slate-100">
                    <td class="py-2 text-slate-700">{{percentage}}%</td>
                    <td class="py-2 text-slate-700 text-right">{{amount}} {{currency}}</td>
                  </tr>
                {{/paymentVatBreakdown}}
              </tbody>
            </table>
          </div>
        {{/isPayment}}

        <p class="text-xs text-slate-500 border-t border-slate-200 pt-4">
          Filed with the French tax administration. Operations with businesses established
          outside France are reported rather than exchanged over the e-invoicing network.
        </p>
      </div>
    </div>
  </body>
</html>`;
