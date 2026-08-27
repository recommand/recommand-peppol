export const FRANCE_B2C_REPORT_TEMPLATE = `<!DOCTYPE html>
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
        {{#isSales}}
          <div>
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Daily totals</p>
            <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt class="text-xs text-slate-500">Category</dt>
                <dd class="text-slate-700">{{categoryLabel}}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">Transactions</dt>
                <dd class="text-slate-700">{{transactionCount}}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">Total excluding VAT</dt>
                <dd class="text-slate-700 font-medium">{{taxExclusiveAmount}} {{currency}}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">Total VAT</dt>
                <dd class="text-slate-700 font-medium">{{taxAmount}} EUR</dd>
              </div>
            </dl>
          </div>

          <div>
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">VAT breakdown</p>
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th class="py-2 font-medium">VAT rate</th>
                  <th class="py-2 font-medium text-right">Taxable amount</th>
                  <th class="py-2 font-medium text-right">VAT amount</th>
                </tr>
              </thead>
              <tbody>
                {{#salesVatBreakdown}}
                  <tr class="border-b border-slate-100">
                    <td class="py-2 text-slate-700">{{percentage}}%</td>
                    <td class="py-2 text-slate-700 text-right">{{taxableAmount}} {{currency}}</td>
                    <td class="py-2 text-slate-700 text-right">{{taxAmount}} EUR</td>
                  </tr>
                {{/salesVatBreakdown}}
              </tbody>
            </table>
          </div>
        {{/isSales}}

        {{#isPayments}}
          <div>
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Payments received</p>
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
                    <td class="py-2 text-slate-700 text-right">{{amount}} EUR</td>
                  </tr>
                {{/paymentVatBreakdown}}
              </tbody>
            </table>
            <p class="mt-2 text-xs text-slate-500">
              Reported for services using cash-basis VAT (TVA sur les encaissements).
            </p>
          </div>
        {{/isPayments}}

        <p class="text-xs text-slate-500 border-t border-slate-200 pt-4">
          Filed with the French tax administration. VAT amounts are reported in EUR.
        </p>
      </div>
    </div>
  </body>
</html>`;
