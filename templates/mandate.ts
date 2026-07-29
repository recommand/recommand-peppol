export const MANDATE_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charSet="utf-8" />
    <title>Mandate for electronic invoicing - {{reference}}</title>
    <style>
      /* Tailwind preflight is injected by the Tailwind PDF generator */
      @page { size: A4; margin: 16mm; }
      body {
        margin: 0;
        padding: 0;
        background: #fff;
      }
      .mandate-section,
      .mandate-party,
      .mandate-scope-item {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    </style>
  </head>
  <body class="text-slate-900">
    <div class="max-w-3xl mx-auto">
      <div class="pb-4 border-b border-slate-200 mandate-section">
        <p class="text-xs font-semibold tracking-wide uppercase text-slate-500">
          Mandate
        </p>
        <h1 class="mt-1 text-2xl font-semibold tracking-tight">
          Mandate for electronic invoicing
        </h1>
        {{#frenchTitle}}
          <p class="mt-1 text-sm text-slate-500">{{frenchTitle}}</p>
        {{/frenchTitle}}
        <p class="mt-3 text-xs text-slate-500 space-x-2">
          <span>Reference: {{reference}}</span>
          <span>&bull;</span>
          <span>Drawn up on {{issueDate}}</span>
        </p>
      </div>

      <div class="py-6 space-y-6">
        <div class="grid grid-cols-2 gap-6 text-sm mandate-section">
          {{#company}}
            <div class="mandate-party">
              <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">
                The company
              </p>
              <p class="font-medium text-slate-900">{{legalName}}</p>
              <p class="text-slate-700 mt-1">{{street}}</p>
              <p class="text-slate-700">{{postalCode}} {{city}}</p>
              <p class="text-slate-700">{{countryName}}</p>
              <dl class="mt-3 space-y-1 text-slate-700">
                {{#rows}}
                  <div class="flex gap-2">
                    <dt class="text-slate-500">{{label}}</dt>
                    <dd class="font-mono">{{value}}</dd>
                  </div>
                {{/rows}}
              </dl>
            </div>
          {{/company}}

          {{#platform}}
            <div class="mandate-party">
              <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">
                The platform
              </p>
              <p class="text-slate-700">{{description}}</p>
            </div>
          {{/platform}}
        </div>

        <div class="mandate-section">
          <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">
            Purpose of the mandate
          </p>
          <p class="text-sm text-slate-700">
            The company mandates the platform to carry out the following operations in its
            name and on its behalf:
          </p>
          <ul class="mt-3 space-y-2 text-sm text-slate-700">
            {{#scopeItems}}
              <li class="flex gap-2 mandate-scope-item">
                <span class="text-slate-400">&bull;</span>
                <span>
                  <span class="font-medium text-slate-900">{{title}}</span>
                  <span class="block text-slate-600">{{description}}</span>
                </span>
              </li>
            {{/scopeItems}}
          </ul>
        </div>

        <div class="mandate-section">
          <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">
            Electronic addresses covered
          </p>
          <ul class="space-y-1 text-sm text-slate-700">
            {{#electronicAddresses}}
              <li class="font-mono break-all">{{value}}</li>
            {{/electronicAddresses}}
          </ul>
          <p class="mt-2 text-xs text-slate-500">
            These addresses identify the company on the Peppol network and in its directory.
          </p>
        </div>

        <div class="mandate-section">
          <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">
            Effective date and duration
          </p>
          <p class="text-sm text-slate-700">
            This mandate takes effect on {{effectiveDate}} and is concluded for
            {{durationLabel}}. The company may revoke it at any time by written notice to the
            platform or to the operator, the revocation taking effect on the date the
            electronic addresses concerned are removed.
          </p>
        </div>

        {{#signatory}}
          <div class="pt-4 border-t border-slate-200 mandate-section">
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">
              Signature of the company
            </p>
            <p class="text-sm text-slate-700">
              The signatory declares to be authorised to bind the company and accepts this
              mandate.
            </p>
            <dl class="mt-3 space-y-1 text-sm text-slate-700">
              <div class="flex gap-2">
                <dt class="text-slate-500">Name</dt>
                <dd class="font-medium text-slate-900">{{fullName}}</dd>
              </div>
              <div class="flex gap-2">
                <dt class="text-slate-500">Role</dt>
                <dd>{{role}}</dd>
              </div>
              <div class="flex gap-2">
                <dt class="text-slate-500">Date</dt>
                <dd>{{signedAt}}</dd>
              </div>
            </dl>
            {{#proofReference}}
              <div class="mt-4 rounded-md border border-slate-200 px-4 py-3 mandate-section">
                <p class="text-xs font-semibold tracking-wide uppercase text-slate-500">
                  Electronic signature
                </p>
                <p class="mt-1 text-sm text-slate-700">
                  Signed electronically after the identity of the signatory was verified by
                  {{proofMethod}}.
                </p>
                <p class="mt-1 text-xs text-slate-500">
                  Proof reference: <span class="font-mono break-all">{{proofReference}}</span>
                </p>
              </div>
            {{/proofReference}}
          </div>
        {{/signatory}}
      </div>
    </div>
  </body>
</html>`;
