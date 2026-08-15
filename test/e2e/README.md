# Send document end-to-end tests

Exhaustive regression suite for the send document API. It runs every
combination of the endpoint's parameters against a real, running playground
environment and asserts that the observable behaviour never changes: the same
HTTP status codes, the same response bodies (field by field), the same error
messages and the same stored document.

The suite is standalone. Apart from `../utils/dev-server`, which only starts and
stops the server process, it imports nothing from the package it lives in, so it
keeps describing the API contract from the outside even when internals are
refactored. Everything it expects (routes, doctype identifiers, process
identifiers, error strings) is written out in `send-document.test.ts` and
`documents.ts`.

It is deliberately kept out of `bun run test`: the unit test script only picks
up `./test/*.test.ts`, so the slow, side effecting suite in this folder never
runs by accident.

Setting `SKIP_E2E=1` skips this suite wherever it is picked up, and also stops
the unit tests from starting a server or calling the API. `bun run test:unit`
sets it, which is what the Kamal `pre-build` hook runs: a build then behaves
the same whether or not `ETE_UNIT_TEST_*` happen to be set.

## Running

If nothing is listening at `ETE_UNIT_TEST_HOST` (`http://localhost:3000` when
it is unset), a dev server is started and stopped again when the run finishes.
A server that was already running is reused and left running. This works for
any `bun test` invocation, because `bunfig.toml` preloads `test/setup.ts`, and
the suite waits for readiness itself as well.

The preloaded setup owns the server: Bun runs its hooks once around the whole
run, so the server stays up for every file. Nothing in this folder may stop it,
because these hooks run around this file only and Bun picks up test files in
filesystem order — stopping it here would kill it under the files that come
after.

```bash
# from the repository root
bun run test:e2e

# from packages/peppol
bun run test:e2e

# a single slice, by test name
bun test --timeout 120000 ./test/e2e/ -t "recipient=null"
bun test --timeout 120000 ./test/e2e/ -t "invoice / recipient"
```

`-t` is a regex matched against the full test name, describe block included, so
anchoring with `^` matches nothing. Matrix names read
`<variant> / recipient=<...> / email=<...> / pdf=<...>`.

Bun reads `.env` from the directory you run in. If the secrets live in
1Password instead, prefix the command:

```bash
op run --environment <id> --account <account> -- bun run test:e2e
```

## Configuration

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `ETE_UNIT_TEST_HOST` | no | `http://localhost:3000` | Server under test |
| `ETE_UNIT_TEST_COMPANY_ID` | yes | | Company that sends the documents |
| `ETE_UNIT_TEST_JWT` | yes | | API key or integration JWT for that company's team |
| `ETE_UNIT_TEST_RECIPIENT` | no | `0208:0598726857` | A reachable Peppol address |
| `ETE_UNIT_TEST_EMAIL_TO` | no | `test@blackhole.postmarkapp.com` | First email recipient |
| `ETE_UNIT_TEST_EMAIL_TO_2` | no | `test+2@blackhole.postmarkapp.com` | Second email recipient |

The team must be a **playground team with the test network disabled**. A
preflight check refuses to run otherwise, so the suite can never send hundreds
of documents onto the live Peppol network. It reads `isPlayground` and
`useTestNetwork` from `GET /api/peppol/playgrounds/current`, which are the same
two flags the API uses to decide whether a send leaves the building. The check
sends nothing.

`ETE_UNIT_TEST_RECIPIENT` should not be a company registered inside the same
playground team. The simulator delivers to such companies for real, which
creates incoming documents on every successful send.

## What it costs

A full run is 615 tests in roughly two minutes against a local server. It sends
about 220 emails through Postmark and stores about 355 documents in the
playground. Emails go to Postmark's blackhole address by default, which accepts
and discards them, but they still count towards your Postmark volume. The suite
also calls the external validation service once per document and the PDF
renderer once per PDF case.

## What is covered

The matrix is the cartesian product of:

- **document variant** (9): `invoice`, `creditNote`, `selfBillingInvoice`,
  `selfBillingCreditNote`, `messageLevelResponse`, `xml`, and `xml` combined
  with `doctypeId`, `processId`, and both. `doctypeId` and `processId` are
  folded into the XML variants because the API only uses them for raw XML.
  Their behaviour on JSON documents is covered by dedicated tests.
- **recipient** (4): a full Peppol address, a bare enterprise number (which the
  API normalises to `0208:`), an address the simulator rejects, and `null`.
- **email** (4): absent, `to` only (so `when` defaults to
  `on_peppol_failure`), `when: "always"`, and two recipients with an explicit
  `when`, `subject` and `htmlBody`.
- **pdfGeneration** (4): absent, `enabled: false`, `enabled: true`, and
  `enabled: true` with a custom `filename`.

For every successful send the suite also fetches the stored document and
asserts its direction, normalised receiver, doctype id, process id, type,
delivery flags, email recipients and generated PDF attachment.

The stored document is parsed back from the XML that was transmitted, so two
separate groups assert the arithmetic. The first covers what the API works out
for itself, since no fixture sends totals: totals calculated from the lines,
VAT subtotalled per rate, the line amounts, and the default PDF filename. One
test round trips a whole invoice, so the fields that were sent have to survive
being written to XML and read back.

The second covers totals and VAT that *were* provided. They are used as given,
including a prepayment, and a document whose totals or VAT contradict its lines
is rejected by validation rather than quietly corrected.

Delivery itself is only asserted as far as the API reports it: `sentOverEmail`,
`emailRecipients` and the stored flags. Nothing checks Postmark, so a mail that
the API accepted but that never left is not caught here.

Outside the matrix it covers authentication failures, the `/sendDocument` and
`/api/v1` route aliases, request schema violations, documents that do not match
their declared `documentType`, undetectable and invalid XML, unrecognised
doctype identifiers with and without a `processId`, the empty `email.to` edge
cases, the totals described above, and the server side defaults for seller,
buyer, dates and message level response ids.
