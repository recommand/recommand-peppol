export const FRENCH_MANDATE_TEMPLATE = `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charSet="utf-8" />
    <title>{{title}} - {{reference}}</title>
    <style>
      /* Tailwind preflight is injected by the Tailwind PDF generator */
      @page { size: A4; margin: 14mm; }
      body {
        margin: 0;
        padding: 0;
        background: #fff;
      }
      .mandate-block,
      .mandate-row {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    </style>
  </head>
  <body class="text-slate-900 text-[11.5px] leading-relaxed">
    <div class="max-w-3xl mx-auto">
      <header class="pb-4 mandate-block">
        <p class="text-[10px] font-semibold tracking-wide uppercase text-slate-500">
          Mandat
        </p>
        <h1 class="mt-1 text-xl font-semibold tracking-tight">{{title}}</h1>
        <p class="mt-1 text-[11px] text-slate-500">{{subtitle}}</p>
        <p class="mt-3 text-[10px] text-slate-500 space-x-2">
          <span>Référence : {{reference}}</span>
          <span>&bull;</span>
          <span>Établi le {{issueDate}}</span>
        </p>
      </header>

      {{#assujetti}}
        <section class="flex gap-4 border-t border-slate-200 py-4 mandate-block">
          <div class="w-6 shrink-0 text-sm font-semibold text-slate-400">1.</div>
          <div class="flex-1">
            <p class="text-slate-700">
              Assujetti donnant mandat à une Plateforme Agréée (désignée en 2) pour inscrire
              une ou plusieurs adresses de facturation électroniques de réception de factures
              dans l'Annuaire PPF :
            </p>
            <dl class="mt-3 grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5">
              <dt class="text-slate-500">Dénomination sociale</dt>
              <dd class="font-medium text-slate-900">{{legalName}}</dd>
              <dt class="text-slate-500">N° de SIREN</dt>
              <dd class="font-mono">{{siren}}</dd>
              <dt class="text-slate-500">Adresse postale</dt>
              <dd>
                {{street}}<br />
                {{postalCode}} {{city}}<br />
                {{countryName}}
              </dd>
            </dl>
          </div>
        </section>
      {{/assujetti}}

      <section class="flex gap-4 border-t border-slate-200 py-4 mandate-block">
        <div class="w-6 shrink-0 text-sm font-semibold text-slate-400">2.</div>
        <div class="flex-1">
          <p class="text-slate-700">
            Plateforme Agréée (PA) désignée par l'Assujetti (désigné en 1) pour inscrire une
            ou plusieurs adresses de facturation électroniques de réception de factures dans
            l'Annuaire PPF :
          </p>
          {{#platform}}
            <dl class="mt-3 grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5">
              <dt class="text-slate-500">Dénomination sociale</dt>
              <dd class="font-medium text-slate-900">{{legalName}}</dd>
              <dt class="text-slate-500">N° de SIREN *</dt>
              <dd class="font-mono">{{#siren}}{{siren}}{{/siren}}{{^siren}}<span class="font-sans text-slate-400">Néant</span>{{/siren}}</dd>
              <dt class="text-slate-500">N° de matricule *</dt>
              <dd class="font-mono">{{matricule}}</dd>
            </dl>
          {{/platform}}
          <p class="mt-2 text-[10px] text-slate-500">* {{platformNumberFootnote}}</p>
        </div>
      </section>

      <section class="flex gap-4 border-t border-slate-200 py-4 mandate-block">
        <div class="w-6 shrink-0 text-sm font-semibold text-slate-400">3.</div>
        <div class="flex-1">
          <p class="text-slate-700">
            Date à partir de laquelle l'Assujetti (désigné en 1) souhaite que l'exécution de
            ce mandat soit effective :
          </p>
          <p class="mt-2 font-mono font-medium text-slate-900">{{effectiveDate}}</p>
        </div>
      </section>

      <section class="flex gap-4 border-t border-slate-200 py-4 mandate-block">
        <div class="w-6 shrink-0 text-sm font-semibold text-slate-400">4.</div>
        <div class="flex-1">
          <p class="text-slate-700">
            Périmètre des adresses de facturation électroniques de réception confiée à la PA
            désignée en 2 :
          </p>
          <ul class="mt-3 space-y-2.5">
            {{#addressCategories}}
              <li class="flex gap-2.5 mandate-row">
                {{#isChecked}}
                  <span class="mt-[3px] inline-block h-3 w-3 shrink-0 rounded-[2px] border border-slate-900 bg-slate-900"></span>
                {{/isChecked}}
                {{^isChecked}}
                  <span class="mt-[3px] inline-block h-3 w-3 shrink-0 rounded-[2px] border border-slate-300"></span>
                {{/isChecked}}
                <span class="flex-1">
                  <span class="{{^isChecked}}text-slate-400{{/isChecked}}">{{label}}</span>
                  {{#addresses}}
                    <span class="block font-mono text-[11px] text-slate-900 break-all">{{value}}</span>
                  {{/addresses}}
                </span>
              </li>
            {{/addressCategories}}
          </ul>
        </div>
      </section>

      <section class="flex gap-4 border-t border-slate-200 py-4 mandate-block">
        <div class="w-6 shrink-0 text-sm font-semibold text-slate-400">5.</div>
        <div class="flex-1">
          <p class="text-slate-700">
            Ancienne PA en charge de tout ou partie des adresses de réception de factures
            décrites au 4 :
          </p>
          {{#previousPlatform}}
            <dl class="mt-3 grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5">
              <dt class="text-slate-500">Dénomination sociale</dt>
              <dd class="font-medium text-slate-900">{{legalName}}</dd>
              <dt class="text-slate-500">N° de SIREN *</dt>
              <dd class="font-mono">{{#siren}}{{siren}}{{/siren}}{{^siren}}<span class="font-sans text-slate-400">Néant</span>{{/siren}}</dd>
              <dt class="text-slate-500">N° de matricule *</dt>
              <dd class="font-mono">{{#matricule}}{{matricule}}{{/matricule}}{{^matricule}}<span class="font-sans text-slate-400">Néant</span>{{/matricule}}</dd>
            </dl>
            <p class="mt-2 text-[10px] text-slate-500">* {{platformNumberFootnote}}</p>
          {{/previousPlatform}}
          {{^previousPlatform}}
            <p class="mt-2 text-slate-500">
              Néant. Aucune des adresses décrites au 4 n'est actuellement confiée à une autre
              Plateforme Agréée.
            </p>
          {{/previousPlatform}}
        </div>
      </section>

      <section class="flex gap-4 border-t border-slate-200 py-4 mandate-block">
        <div class="w-6 shrink-0 text-sm font-semibold text-slate-400">6.</div>
        <div class="flex-1">
          <p class="text-slate-700">
            Numéro de mandat (SIREN Entreprise_SIREN PA (à défaut n° de matricule)_AAAAMMJJ_Compteur) :
          </p>
          <dl class="mt-3 space-y-1.5">
            {{#mandateNumbers}}
              <div class="grid grid-cols-[14rem_1fr] gap-x-4 mandate-row">
                <dt class="font-mono text-[11px] text-slate-500 break-all">{{address}}</dt>
                <dd class="font-mono font-medium text-slate-900 break-all">{{value}}</dd>
              </div>
            {{/mandateNumbers}}
          </dl>
        </div>
      </section>

      {{#signatory}}
        <section class="flex gap-4 border-t border-slate-200 py-4 mandate-block">
          <div class="w-6 shrink-0 text-sm font-semibold text-slate-400">7.</div>
          <div class="flex-1">
            <p class="text-slate-700">
              Signature du représentant légal de l'Assujetti désigné au 1 ou d'un représentant
              disposant d'une délégation :
            </p>
            <dl class="mt-3 grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5">
              <dt class="text-slate-500">Prénom</dt>
              <dd class="font-medium text-slate-900">{{firstName}}</dd>
              <dt class="text-slate-500">Nom</dt>
              <dd class="font-medium text-slate-900">{{lastName}}</dd>
              <dt class="text-slate-500">Fonction</dt>
              <dd>{{role}}</dd>
              <dt class="text-slate-500">Date</dt>
              <dd class="font-mono">{{signedAt}}</dd>
            </dl>
            {{#proofReference}}
              <div class="mt-4 rounded-md border border-slate-200 px-4 py-3 mandate-block">
                <p class="text-[10px] font-semibold tracking-wide uppercase text-slate-500">
                  Signature
                </p>
                <p class="mt-1 text-slate-700">
                  Signé électroniquement après vérification de l'identité du signataire par
                  {{proofMethod}}.
                </p>
                <p class="mt-1 text-[10px] text-slate-500">
                  Référence de preuve : <span class="font-mono break-all">{{proofReference}}</span>
                </p>
              </div>
            {{/proofReference}}
            {{^proofReference}}
              <div class="mt-4 rounded-md border border-dashed border-slate-300 px-4 py-3 mandate-block">
                <p class="text-[10px] font-semibold tracking-wide uppercase text-slate-500">
                  Signature
                </p>
                <p class="mt-1 text-slate-500">
                  Projet non signé. La signature est apposée par la vérification d'identité
                  du signataire.
                </p>
              </div>
            {{/proofReference}}
          </div>
        </section>
      {{/signatory}}

      {{#annex}}
        <section class="mt-6 border-t-2 border-slate-300 pt-4 mandate-block">
          <p class="text-[10px] font-semibold tracking-wide uppercase text-slate-500">
            Annexe
          </p>
          <h2 class="mt-1 text-base font-semibold tracking-tight">
            Délégations complémentaires
          </h2>
          <p class="mt-2 text-[11px] text-slate-600">{{intro}}</p>
          <ul class="mt-3 space-y-2">
            {{#items}}
              <li class="flex gap-2 mandate-row">
                <span class="text-slate-400">&bull;</span>
                <span>
                  <span class="font-medium text-slate-900">{{title}}</span>
                  <span class="block text-slate-600">{{description}}</span>
                </span>
              </li>
            {{/items}}
          </ul>
          <p class="mt-3 text-[11px] text-slate-600">
            L'Assujetti peut révoquer le présent mandat et ses annexes à tout moment par
            notification écrite à la Plateforme Agréée ou à l'opérateur, la révocation prenant
            effet à la date de retrait des adresses concernées.
          </p>
        </section>
      {{/annex}}

      <footer class="mt-6 border-t border-slate-200 pt-3 text-[10px] text-slate-500 mandate-block">
        {{operatorNote}}
      </footer>
    </div>
  </body>
</html>`;
