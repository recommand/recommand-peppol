export const MANDATE_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charSet="utf-8" />
    <title>{{title}} - {{reference}}</title>
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
  <body class="text-black">
    <div class="max-w-3xl mx-auto">
      <div class="pb-4 border-b border-black mandate-section">
        <p class="text-xs font-semibold tracking-wide uppercase">
 Mandate
        </p>
        <h1 class="mt-1 text-2xl font-semibold tracking-tight">{{title}}</h1>
        <p class="mt-3 text-xs space-x-2">
          <span>Reference: {{reference}}</span>
          <span>&bull;</span>
          <span>Drawn up on {{issueDate}}</span>
        </p>
      </div>

      <div class="py-6 space-y-6">
        <div class="grid grid-cols-2 gap-6 text-sm mandate-section">
 {{#company}}
            <div class="mandate-party">
              <p class="text-xs font-semibold tracking-wide uppercase mb-2">
 The company
              </p>
              <p class="font-medium">{{legalName}}</p>
              <p class="mt-1">{{street}}</p>
              <p>{{postalCode}} {{city}}</p>
              <p>{{countryName}}</p>
              <dl class="mt-3 space-y-1">
 {{#rows}}
                  <div class="flex gap-2">
                    <dt>{{label}}</dt>
                    <dd class="font-mono">{{value}}</dd>
                  </div>
 {{/rows}}
              </dl>
            </div>
 {{/company}}

 {{#platform}}
            <div class="mandate-party">
              <p class="text-xs font-semibold tracking-wide uppercase mb-2">
 The platform
              </p>
              <p>{{description}}</p>
            </div>
 {{/platform}}
        </div>

        <div class="mandate-section">
          <p class="text-xs font-semibold tracking-wide uppercase mb-2">
 Purpose of the mandate
          </p>
          <p class="text-sm">
 The company mandates the platform to carry out the following operations in its
 name and on its behalf:
          </p>
          <ul class="mt-3 space-y-2 text-sm">
 {{#scopeItems}}
              <li class="flex gap-2 mandate-scope-item">
                <span>&bull;</span>
                <span>
                  <span class="font-medium">{{title}}</span>
                  <span class="block">{{description}}</span>
                </span>
              </li>
 {{/scopeItems}}
          </ul>
        </div>

        <div class="mandate-section">
          <p class="text-xs font-semibold tracking-wide uppercase mb-2">
 Electronic addresses covered
          </p>
          <ul class="space-y-1 text-sm">
 {{#electronicAddresses}}
              <li class="font-mono break-all">{{value}}</li>
 {{/electronicAddresses}}
          </ul>
          <p class="mt-2 text-xs">
 These addresses identify the company on the Peppol network and in its directory.
          </p>
        </div>

        <div class="mandate-section">
          <p class="text-xs font-semibold tracking-wide uppercase mb-2">
 Effective date and duration
          </p>
          <p class="text-sm">
 This mandate takes effect on {{effectiveDate}} and is concluded for
 {{durationLabel}}. The company may revoke it at any time by written notice to the
 platform or to the operator, the revocation taking effect on the date the
 electronic addresses concerned are removed.
          </p>
        </div>

 {{#signatory}}
          <div class="pt-4 border-t border-black mandate-section">
            <p class="text-xs font-semibold tracking-wide uppercase mb-2">
 Signature of the company
            </p>
            <p class="text-sm">
 The signatory declares to be authorised to bind the company and accepts this
 mandate.
            </p>
            <dl class="mt-3 space-y-1 text-sm">
              <div class="flex gap-2">
                <dt>Name</dt>
                <dd class="font-medium">{{fullName}}</dd>
              </div>
              <div class="flex gap-2">
                <dt>Role</dt>
                <dd>{{role}}</dd>
              </div>
              <div class="flex gap-2">
                <dt>Date</dt>
                <dd>{{signedAt}}</dd>
              </div>
            </dl>
 {{#proofReference}}
              <div class="mt-4 rounded-md border border-black px-4 py-3 mandate-section">
                <p class="text-xs font-semibold tracking-wide uppercase">
 Electronic signature
                </p>
                <p class="mt-1 text-sm">
 Signed electronically after the identity of the signatory was verified by
 {{proofMethod}}.
                </p>
                <p class="mt-1 text-xs">
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
