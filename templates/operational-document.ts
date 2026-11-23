/**
 * The layout of the post-award documents (order, order response, despatch advice).
 * They differ in which parties, details and line columns they show, so the template
 * takes those as lists rather than naming fields; the renderer decides what goes in.
 */
export const OPERATIONAL_DOCUMENT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charSet="utf-8" />
    <title>{{documentTypeLabel}} {{documentNumber}}</title>
    <style>
      /* Tailwind preflight is injected by the Tailwind PDF generator */
      body { margin: 0; padding: 0; }
    </style>
  </head>
  <body class="bg-slate-100 text-slate-900">
    <div class="max-w-3xl mx-auto my-8 bg-white shadow-sm rounded-lg overflow-hidden">
      <div class="px-8 pt-8 pb-4 border-b border-slate-200">
        <p class="text-xs font-semibold tracking-wide uppercase text-slate-500">
          {{documentTypeLabel}}
        </p>
        <h1 class="mt-1 text-2xl font-semibold tracking-tight">{{documentNumber}}</h1>
        {{#status}}
          <p class="mt-2 inline-block rounded px-2 py-0.5 text-xs font-medium {{#isPositive}}bg-green-100 text-green-800{{/isPositive}}{{#isNegative}}bg-red-100 text-red-800{{/isNegative}}{{#isNeutral}}bg-slate-100 text-slate-700{{/isNeutral}}">
            {{label}}
          </p>
        {{/status}}
        <p class="mt-2 text-xs text-slate-500">
          {{#meta}}
            <span class="inline-block mr-3">{{label}}: {{value}}</span>
          {{/meta}}
        </p>
      </div>

      {{#note}}
        <div class="px-8 py-4 border-b border-slate-200">
          <p class="text-sm text-slate-700 whitespace-pre-wrap">{{note}}</p>
        </div>
      {{/note}}

      <div class="px-8 py-6 grid grid-cols-2 gap-8 border-b border-slate-200 text-sm">
        {{#parties}}
          <div>
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-1">{{role}}</p>
            <p class="font-medium">{{name}}</p>
            {{#lines}}<p class="text-slate-600">{{.}}</p>{{/lines}}
            {{#details}}<p class="mt-1 text-xs text-slate-500">{{.}}</p>{{/details}}
          </div>
        {{/parties}}
      </div>

      {{#sections.length}}
        <div class="px-8 py-6 grid grid-cols-2 gap-8 border-b border-slate-200 text-sm">
          {{#sections}}
            <div>
              <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-1">{{title}}</p>
              {{#rows}}
                <p class="text-slate-600"><span class="text-slate-500">{{label}}:</span> {{value}}</p>
              {{/rows}}
            </div>
          {{/sections}}
        </div>
      {{/sections.length}}

      {{#lines.length}}
        <div class="px-8 pt-6 pb-4">
          <table class="w-full text-xs">
            <thead class="border-b border-slate-200 text-slate-500">
              <tr class="text-left">
                <th class="py-2 pr-3 font-medium">#</th>
                <th class="py-2 pr-3 font-medium">Description</th>
                {{#columns}}
                  <th class="py-2 pl-3 font-medium text-right whitespace-nowrap">{{.}}</th>
                {{/columns}}
              </tr>
            </thead>
            <tbody>
              {{#lines}}
                <tr class="border-b border-slate-100 last:border-0 align-top">
                  <td class="py-2 pr-3 font-mono text-[11px] text-slate-500">{{id}}</td>
                  <td class="py-2 pr-3">
                    <p class="font-medium text-slate-900 leading-tight">{{name}}</p>
                    {{#details}}
                      <p class="mt-0.5 text-[11px] text-slate-500 whitespace-pre-wrap">{{.}}</p>
                    {{/details}}
                  </td>
                  {{#cells}}
                    <td class="py-2 pl-3 text-right font-mono text-[11px] whitespace-nowrap">{{.}}</td>
                  {{/cells}}
                </tr>
              {{/lines}}
            </tbody>
          </table>
        </div>
      {{/lines.length}}

      {{#totals.length}}
        <div class="px-8 pb-8 flex justify-end">
          <div class="w-full max-w-xs text-xs">
            {{#totals}}
              <div class="flex justify-between py-1 {{#emphasis}}mt-2 pt-2 border-t border-slate-200 font-semibold{{/emphasis}}">
                <span class="{{^emphasis}}text-slate-500{{/emphasis}}">{{label}}</span>
                <span class="font-mono">{{value}}</span>
              </div>
            {{/totals}}
          </div>
        </div>
      {{/totals.length}}
    </div>
  </body>
</html>`;
