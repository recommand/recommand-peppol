export const BILLING_DOCUMENT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charSet="utf-8" />
    <title>{{documentTypeLabel}} {{#documentNumber}}{{documentNumber}}{{/documentNumber}}</title>
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
              {{#documentNumber}}{{documentNumber}}{{/documentNumber}}{{^documentNumber}}{{documentId}}{{/documentNumber}}
            </h1>
            <p class="mt-2 text-xs text-slate-500 space-x-2">
              <span>Issue date: {{issueDate}}</span>
              {{#dueDate}}
                <span>&bull;</span>
                <span>Due date: {{dueDate}}</span>
              {{/dueDate}}
              {{#buyerReference}}
                <span>&bull;</span>
                <span>Buyer reference: {{buyerReference}}</span>
              {{/buyerReference}}
            </p>
          </div>
        </div>
      </div>

      {{#note}}
        <div class="px-8 py-4 border-b border-slate-200">
          <p class="text-sm text-slate-700 whitespace-pre-wrap">{{note}}</p>
        </div>
      {{/note}}

      <div class="px-8 py-6 grid grid-cols-2 gap-8 border-b border-slate-200 text-sm">
        <div>
          <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-1">Seller</p>
          {{#seller}}
            <p class="font-medium">{{name}}</p>
            <p class="text-slate-600">{{street}}</p>
            {{#street2}}<p class="text-slate-600">{{street2}}</p>{{/street2}}
            <p class="text-slate-600">{{postalZone}} {{city}}</p>
            <p class="text-slate-600">{{country}}</p>
            {{#vatNumber}}<p class="mt-1 text-xs text-slate-500">VAT {{vatNumber}}</p>{{/vatNumber}}
            {{#email}}<p class="mt-1 text-xs text-slate-500">{{email}}</p>{{/email}}
            {{#phone}}<p class="mt-1 text-xs text-slate-500">{{phone}}</p>{{/phone}}
          {{/seller}}
          {{^seller}}
            <p class="text-slate-500">-</p>
          {{/seller}}
        </div>
        <div>
          <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-1">Buyer</p>
          {{#buyer}}
            <p class="font-medium">{{name}}</p>
            <p class="text-slate-600">{{street}}</p>
            {{#street2}}<p class="text-slate-600">{{street2}}</p>{{/street2}}
            <p class="text-slate-600">{{postalZone}} {{city}}</p>
            <p class="text-slate-600">{{country}}</p>
            {{#vatNumber}}<p class="mt-1 text-xs text-slate-500">VAT {{vatNumber}}</p>{{/vatNumber}}
            {{#email}}<p class="mt-1 text-xs text-slate-500">{{email}}</p>{{/email}}
            {{#phone}}<p class="mt-1 text-xs text-slate-500">{{phone}}</p>{{/phone}}
          {{/buyer}}
          {{^buyer}}
            <p class="text-slate-500">-</p>
          {{/buyer}}
        </div>
      </div>

      <div class="px-8 pt-6 pb-4">
        <table class="w-full text-xs">
          <thead class="border-b border-slate-200 text-slate-500">
            <tr class="text-left">
              <th class="py-2 pr-3 font-medium">#</th>
              <th class="py-2 pr-3 font-medium">Description</th>
              <th class="py-2 pr-3 font-medium text-right whitespace-nowrap">Qty</th>
              <th class="py-2 pr-3 font-medium text-right whitespace-nowrap">Unit price</th>
              <th class="py-2 pr-3 font-medium text-right whitespace-nowrap">VAT %</th>
              <th class="py-2 pl-3 font-medium text-right whitespace-nowrap">Line total</th>
            </tr>
          </thead>
          <tbody>
            {{#lines}}
              <tr class="border-b border-slate-100 last:border-0 align-top">
                <td class="py-2 pr-3 font-mono text-[11px] text-slate-500">{{#id}}{{id}}{{/id}}{{^id}}{{@indexPlusOne}}{{/id}}</td>
                <td class="py-2 pr-3">
                  <p class="font-medium text-slate-900 leading-tight">{{name}}</p>
                  {{#description}}
                    <p class="mt-0.5 text-[11px] text-slate-500 whitespace-pre-wrap">{{description}}</p>
                  {{/description}}
                  {{#note}}
                    <p class="mt-0.5 text-[11px] text-slate-500 italic whitespace-pre-wrap">{{note}}</p>
                  {{/note}}
                  {{#discounts}}
                    <p class="mt-0.5 text-[11px] text-slate-500">
                      <span class="text-red-600">Discount:</span>
                      <span class="font-mono">{{amount}} {{currency}}</span>
                    </p>
                  {{/discounts}}
                  {{#surcharges}}
                    <p class="mt-0.5 text-[11px] text-slate-500">
                      <span class="text-green-600">Surcharge:</span>
                      <span class="font-mono">{{amount}} {{currency}}</span>
                    </p>
                  {{/surcharges}}
                </td>
                <td class="py-2 pr-3 text-right font-mono text-[11px] whitespace-nowrap">
                  {{quantity}} {{unitCodeName}}
                </td>
                <td class="py-2 pr-3 text-right font-mono text-[11px] whitespace-nowrap">
                  {{netPriceAmount}}
                </td>
                <td class="py-2 pr-3 text-right font-mono text-[11px] whitespace-nowrap">
                  {{vatPercentage}}
                </td>
                <td class="py-2 pl-3 text-right font-mono text-[11px] whitespace-nowrap">
                  {{netAmount}}
                </td>
              </tr>
            {{/lines}}
          </tbody>
        </table>
      </div>

      <div class="px-8 pb-8 flex justify-end">
        <div class="w-full max-w-xs text-xs">
          <div class="flex justify-between py-1">
            <span class="text-slate-500">Total (excl. VAT)</span>
            <span class="font-mono">
              {{totals.taxExclusiveAmount}} {{currency}}
            </span>
          </div>
          {{#totals.discountAmount}}
            <div class="flex justify-between py-1">
              <span class="text-slate-500">Discount</span>
              <span class="font-mono">
                {{totals.discountAmount}} {{currency}}
              </span>
            </div>
          {{/totals.discountAmount}}
          {{#totals.surchargeAmount}}
            <div class="flex justify-between py-1">
              <span class="text-slate-500">Surcharge</span>
              <span class="font-mono">
                {{totals.surchargeAmount}} {{currency}}
              </span>
            </div>
          {{/totals.surchargeAmount}}
          <div class="flex justify-between py-1">
            <span class="text-slate-500">VAT</span>
            <span class="font-mono">
              {{totals.vatAmount}} {{currency}}
            </span>
          </div>
          {{#vatSubtotals}}
            <div class="py-1 pl-4 text-[11px]">
              <div class="flex justify-between">
                <span class="text-slate-500">
                  <span class="font-medium">{{percentage}}% {{category}}</span>
                  {{#exemptionReasonCode}}
                    <span class="ml-2 text-slate-400">(Exemption: {{exemptionReasonCode}})</span>
                  {{/exemptionReasonCode}}
                  {{^exemptionReasonCode}}
                    {{#exemptionReason}}
                      <span class="ml-2 text-slate-400">({{exemptionReason}})</span>
                    {{/exemptionReason}}
                  {{/exemptionReasonCode}}
                </span>
                <span class="font-mono text-slate-500">
                  {{vatAmount}} {{currency}}
                </span>
              </div>
            </div>
          {{/vatSubtotals}}
          <div class="flex justify-between py-2 mt-2 border-t border-slate-200 font-semibold">
            <span>Total (incl. VAT)</span>
            <span class="font-mono">
              {{totals.taxInclusiveAmount}} {{currency}}
            </span>
          </div>
          {{#totals.paidAmount}}
            <div class="flex justify-between py-1">
              <span class="text-slate-500">Amount paid</span>
              <span class="font-mono">
                {{totals.paidAmount}} {{currency}}
              </span>
            </div>
          {{/totals.paidAmount}}
          {{#totals.payableAmount}}
            <div class="flex justify-between py-1">
              <span class="text-slate-500">Amount payable</span>
              <span class="font-mono">
                {{totals.payableAmount}} {{currency}}
              </span>
            </div>
          {{/totals.payableAmount}}
        </div>
      </div>

      {{#paymentMeans.length}}
        <div class="px-8 py-6 border-t border-slate-200">
          <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-3">Payment Information</p>
          <div class="space-y-3 text-sm">
            {{#paymentMeans}}
              <div class="space-y-1">
                <p class="font-medium text-slate-900">{{paymentMethodName}}</p>
                {{#iban}}<p class="text-slate-600 font-mono">{{iban}}</p>{{/iban}}
                {{#reference}}
                  <p class="text-xs text-slate-500">Reference: {{reference}}</p>
                {{/reference}}
                {{#financialInstitutionBranch}}
                  <p class="text-xs text-slate-500">BIC/Branch: {{financialInstitutionBranch}}</p>
                {{/financialInstitutionBranch}}
              </div>
            {{/paymentMeans}}
          </div>
        </div>
      {{/paymentMeans.length}}
    </div>
  </body>
</html>`;


