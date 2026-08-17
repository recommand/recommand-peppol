# Send document regression tests

Replays recorded production sends against a playground environment and asserts
that the API still answers the same way. Where the end-to-end suite next door
asserts a hand written matrix of cases, this suite asserts whatever real
integrations actually send.

For every send document recording it finds — the newest 1000 by default — it
sends the same request again and compares three things with what was recorded:

1. the **HTTP status code**, exactly;
2. the **response body**, field by field and independently of any ordering, for
   a send the API accepted;
3. the **transmitted XML**, as the API hands it back from the stored document.

Two kinds of send are asserted less strictly, because their answer is not a
contract the suite should hold the code to: a **rejection**, whose status code
is compared but whose body is not, and a send whose outcome the **Peppol
network** decided rather than the API. Both are explained below, and both are
counted and reported at the end of a run.

The suite is standalone. It imports nothing from the application packages — not
even the dev server helper — so it keeps describing the API contract from the
outside however the internals are refactored. Everything it knows about
recordings (their S3 layout and their shape) is written out in `recordings.ts`,
so a change to the recorder shows up here as a failure rather than as silence.

It never runs by accident: `bun run test:unit` only picks up `./test/*.test.ts`,
which is what the Kamal `pre-build` hook runs, and no deploy hook invokes it.
Run it by hand with `bun run test:regression`.

## Recordings

The API writes one JSON blob per send to S3 when
`PEPPOL_SEND_DOCUMENT_RECORDINGS_S3_BUCKET` is set:

```
peppol-send-document-recordings/<teamId>/<companyId>/<yyyy>/<mm>/<dd>/<id>.json
```

Each holds the request that was received, the status and body that were
answered, and the XML that was transmitted. The key sorts chronologically, so
the newest recordings are the last ones — which is what the suite replays.

### Choosing which ones to replay

Two knobs. `REGRESSION_RECORDING_LIMIT` takes the newest N (1000 by default,
`0` for all of them), and `REGRESSION_RECORDING_PREFIX` narrows the listing to
part of the bucket. Because the key spells out the team, then the company, then
the date, a prefix can select any level of that — including a day:

```bash
# everything for one team
REGRESSION_RECORDING_PREFIX=peppol-send-document-recordings/team_01H…

# everything for one company
REGRESSION_RECORDING_PREFIX=peppol-send-document-recordings/team_01H…/c_01H…

# one company, one day
REGRESSION_RECORDING_PREFIX=peppol-send-document-recordings/team_01H…/c_01H…/2026/08/16

# one company, one month
REGRESSION_RECORDING_PREFIX=peppol-send-document-recordings/team_01H…/c_01H…/2026/08
```

A prefix has to match the key from its start, so a day can only be selected
*within* a company — the date sits after the team and the company in the path.
To cover one day across every company, replay the newest recordings instead:
`REGRESSION_RECORDING_LIMIT` counts back from the most recent, so a day's worth
of traffic is a limit, not a prefix.

The suite prints how many recordings it loaded and where from before it starts,
and fails with the source and the prefix if that came to nothing.

## Running

```bash
# from the repository root
bun run test:regression

# from packages/peppol
bun run test:regression

# one recording, by its key — or any part of one
bun test --timeout 120000 --only-failures ./test/regression/ -t "team_01H…/c_01H…/2026/08/16/sdr_01K….json"

# every recording of one day, or of one company
bun test --timeout 120000 --only-failures ./test/regression/ -t "2026/08/16"
bun test --timeout 120000 --only-failures ./test/regression/ -t "c_01H…"
```

Passing tests do not print. The suite writes one status line instead — how many
have run, a bar, how many have failed, how long is left — and only a failure
breaks it, in full, followed by bun's summary at the end:

```
  347/1000  [=======>            ]  2 fail  8m left  …/2026/08/16/sdr_01K….json (invoice → 200)
```

The `test:regression` script passes `--only-failures` so bun does not print a
line per pass; add the same flag when you invoke `bun test` by hand, or the
status line is overwritten by those passes.

Each test is named after the object it replays — its whole key in the bucket,
followed by the document type and the status that was recorded:

```
peppol-send-document-recordings/team_01H…/c_01H…/2026/08/16/sdr_01K….json (invoice → 422)
```

So a failure says which object to fetch to see what went in, and re-running
just that one is a matter of pasting the name after `-t`. It is matched as a
regex against the full name, describe block included, so anchoring with `^`
matches nothing, and any fragment of the key — a day, a company, a team —
selects everything under it.

If nothing is listening at `ETE_UNIT_TEST_HOST`, a dev server is started and
stopped again when the run finishes: `bunfig.toml` preloads `test/setup.ts`,
the same mechanism the end-to-end suite uses. A server that was already running
is reused and left running.

Bun reads `.env` from the directory you run in, so run from the repository root
or export the variables yourself. If the secrets live in 1Password, prefix the
command with `op run --environment <id> --account <account> --`.

## Configuration

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `ETE_UNIT_TEST_HOST` | no | `http://localhost:3000` | Server under test |
| `ETE_UNIT_TEST_COMPANY_ID` | yes | | Playground company the recordings are replayed as |
| `ETE_UNIT_TEST_JWT` | yes | | API key or integration JWT for that company's team |
| `REGRESSION_RECORDING_LIMIT` | no | `1000` | How many of the newest recordings to replay; `0` means all |
| `REGRESSION_RECORDING_PREFIX` | no | `peppol-send-document-recordings` | Narrows the listing to a team, a company, or a company on one day |
| `REGRESSION_RECORDING_DIR` | no | | A local directory of recording JSON files, used instead of S3 |

### Where the recordings are read from

Each of these falls back to the variable the recorder itself writes with, so an
environment that already holds the production values needs no configuration of
its own. Set the `REGRESSION_RECORDING_S3_*` variable in front of it to read
from somewhere else — a copy of the bucket, a read only key, another account —
without touching the variables the application records with. A blank override
counts as unset and falls through.

| Setting | Override | Falls back to | Required |
| --- | --- | --- | --- |
| Bucket | `REGRESSION_RECORDING_S3_BUCKET` | `PEPPOL_SEND_DOCUMENT_RECORDINGS_S3_BUCKET` | yes |
| Access key | `REGRESSION_RECORDING_S3_ACCESS_KEY_ID` | `PEPPOL_SEND_DOCUMENT_RECORDINGS_S3_ACCESS_KEY_ID` | yes |
| Secret key | `REGRESSION_RECORDING_S3_SECRET_ACCESS_KEY` | `PEPPOL_SEND_DOCUMENT_RECORDINGS_S3_SECRET_ACCESS_KEY` | yes |
| Endpoint | `REGRESSION_RECORDING_S3_ENDPOINT` | `S3FS_ENDPOINT` | yes |
| Region | `REGRESSION_RECORDING_S3_REGION` | `S3FS_REGION` | no |

The suite only lists and reads, so a key with read access is enough — which is
the point of being able to override the credentials rather than reusing the
ones that can write to the bucket. `REGRESSION_RECORDING_DIR` bypasses all of
it and reads recordings from a local directory instead.

The team must be a **playground team with the test network disabled**. A
preflight check refuses to run otherwise. This matters more here than anywhere
else in the test suite: recordings are other people's real invoices, and
without the check a misconfigured run would put them onto the live Peppol
network. It reads `isPlayground` and `useTestNetwork` from
`GET /api/peppol/playgrounds/current` and sends nothing.

## What is rewritten before a request is replayed

**Email recipients.** A recorded request carries the real addresses of real
customers. Every address in `email.to` is swapped for
`regression+<n>@blackhole.postmarkapp.com`, which Postmark accepts and
discards, and the same swap is applied to the recorded `emailRecipients` so the
comparison still lines up.

**The company id in the path.** Only that segment changes, so a recording of
`/api/v1/:id/send` still exercises the `/api/v1` alias.

Nothing else about the request is touched.

## What is masked before a response is compared

A recording was made by production, for a production company, at the moment it
was captured; the replay runs against a playground company, now. Anything the
API derives from the *request* has to come out identical or it is a regression.
Anything it derives from the *environment* cannot, and is masked instead. Masks
hide regressions, so each one is as narrow as it can be, and a field the
request supplied is never masked.

Masked in the response body: `id`, `teamId`, `companyId`, `peppolMessageId`,
`envelopeId`, and the `additionalPeppolFailureContext` /
`additionalEmailFailureContext` strings, which quote the access point or the
mail provider verbatim.

Masked in the XML (see `normalise.ts`):

| Element | Why | When |
| --- | --- | --- |
| `EndpointID`, `URIUniversalCommunication` | The sender's Peppol address is the replay company's, under a different scheme (`0208:` where production had `9925:`), so the `schemeID` attribute is masked with it | only inside the party that holds the sender |
| `EmbeddedDocumentBinaryObject`, `BinaryObject` | A generated PDF carries its creation date, so it is not byte reproducible | always |
| `AccountingSupplierParty`, `SellerTradeParty` | Defaulted from the sending company | only when the request omits `seller` |
| `AccountingCustomerParty`, `BuyerTradeParty` | Defaulted from the sending company | only when the request omits `buyer` |
| `IssueDate`, `IssueDateTime` | Defaulted to the day of the send | only when the request omits `issueDate` |
| `DueDate`, `PaymentDueDate` | Defaulted to a month after the issue date | only when the request omits `dueDate` |

Which party carries the sender's address depends on the document: the supplier
on an invoice, the customer on a self-billing invoice (which the customer
writes), the `SenderParty` on a message level response, and nowhere at all on a
French CDAR, which writes an electronic address for the recipient only.
`SENDER_PARTY_ELEMENTS` in `normalise.ts` lists them per document type, and the
address is masked inside that party alone — the recipient's stays compared.

Naming the party rather than recognising the sender's address by its value is
what makes a **send to one's own address** work. Those exist in the bucket:
integrators test against their own Peppol address, so the recording has the
same address in both parties while the replay has the playground company in one
of them. No rule phrased in terms of values can tell the two apart there.

The CII wrapper `URIUniversalCommunication` is masked rather than the `URIID`
inside it because CII uses that same name for a contact's email address and for
an attachment's URL, neither of which the environment decides.

A raw XML send transmits the string it was given, so nothing about it is
environment derived and **nothing is masked**: it has to come back byte for
byte. Attachments that a request supplied itself are the one deliberate
over-reach — they are masked along with generated PDFs, because the two are not
distinguishable in the XML.

## How the response body is compared

Field by field, to any depth, and independently of ordering. Object key order
never mattered, but array order did, and every array a send answers with is
semantically a set: the recipients a mail went to (`emailRecipients`), the
validation messages for a field (`errors`), the entries of
`invalidInputDetails`. Their order follows the order of the request or the
order of the fields in a schema, so a refactor can shuffle them without
changing what the API did. Both sides are therefore sorted before they are
compared — which does mean a reordering that *is* meaningful would not be
caught. Contents still are: a missing, added or changed element fails.

This applies to the response body only. Element order in the XML is part of the
document, so the XML is compared as it stands.

## Requests the API rejected

For a recording that ended in a 4xx, **only the status code is compared**. The
body is not.

Which requests the API refuses is the contract: a payload that was rejected
with a 400 must still be rejected with a 400, and one that was accepted must
still be accepted. The wording it refuses them with is not — error messages get
clarified and translated, and a suite that failed on every improvement to them
would be a reason to stop improving them.

The cost is real and worth stating: a 400 that starts being refused for a
*different* reason than it was, and a rejection that names a different field,
both go unnoticed. The end-to-end suite next door is where exact error messages
are pinned down, on cases written by hand for the purpose; this suite is aimed
at real traffic, where the same rewording would otherwise fail hundreds of
recordings at once.

A rejected send stores no document, so those recordings have no XML to compare
either — they are asserted by their status code alone, and counted in the
summary at the end of the run.

## Sends that the network decided, not the API

Plenty of production sends fail for reasons that have nothing to do with our
code: the receiving access point was down, or the recipient was never
registered on the network. The playground cannot reproduce either — its
simulator accepts every address — so replaying those recordings straight would
report a regression on every one of them, and at a thousand recordings that
noise would bury the real findings.

What is *not* reproducible is only the delivery. Everything the API decided
before handing the document over — parsing the request, applying the defaults,
resolving the doctype and process ids, generating and validating the XML — is
reproducible, and is where a regression in one of these sends would show up
anyway. The recorder captures the XML before the send is attempted, so a
recording that ended in a 422 still carries the document it built.

So a recording whose outcome the network settled is asserted on that part
alone:

- its **XML is compared as strictly as any other recording's**;
- its **status and body are not compared**; all that is asserted is that the
  request still got as far as being handed to the network, i.e. that it was not
  rejected earlier with a 400.

Three signals mark such a recording, all readable from the recorded response
alone (`networkDecidedOutcome` in `normalise.ts`):

| Signal | What happened |
| --- | --- |
| status `422` | Delivery failed. It is the only 422 the send API answers — every other rejection is a 400 |
| `sentOverPeppol: false` | Delivery failed and the email fallback saved it, so the `200` was decided by the network too |
| `additionalPeppolFailureContext` | The access point's own account of what went wrong |

The check is applied to the replay as well as to the recording, so it also
covers the opposite case: a recipient the production network accepted but the
simulator is hardcoded to refuse. When that happens no document is stored and
there is no XML to compare either.

What was compared and what was let past are both counted at the end, so a run
that quietly compared very little cannot look like a thorough one — and one
that compared a great deal is not made to look lax either:

```
Of 7 recording(s):
  4 had the XML they transmitted compared in full
  2 ended the way the network answered rather than the way the API decided, so their status and body were not compared — their XML still was
  1 predate a change listed in improvements.ts, so they were held to the new behaviour rather than to the recorded one
  2 were rejected, so their status was compared but their body was not
```

The counts overlap on purpose: a recording the network decided appears on both
the first line and the second, because both are true of it.

Forcing the failure instead — rewriting the recipient to the address the
simulator refuses — was the obvious alternative and is not done: it would
change the request under test, and the failure message would still be the
simulator's rather than the access point's.

## Sends the playground company's own identity decides

There is one piece of the environment that masking cannot reach: the seller.

When a request omits `seller`, the API fills it in from the company doing the
sending — the customer's company in production, the playground company here.
The comparison masks the difference, but the *validator* sees the real
document, and a dozen Schematron rules turn on whether the seller has a VAT
number at all. A company that is not VAT registered sends an invoice whose
lines are "Not subject to VAT"; production builds it without a seller VAT
identifier and it passes; the replay builds it with the playground company's
and BR-O-02 refuses it:

```
BR-O-02: An Invoice that contains an Invoice line (BG-25) where the Invoiced item VAT
category code (BT-151) is "Not subject to VAT" shall not contain the Seller VAT
identifier (BT-31), …
```

Nothing about the API changed there — the sender did. `senderIdentityRejection`
in `normalise.ts` recognises it, and those recordings are counted in the summary
instead of failing. It is deliberately narrow, because this is the mask most
likely to hide something real:

- only for a request that **left the seller to be filled in**. One that supplied
  its own seller is compared as strictly as anything else, so the same BR-O-02
  fails the run;
- only when **every** rule that fired is about the seller's VAT identity
  (`BT-31`, `BT-63`), so a document with any other problem still fails;
- only where the **recording succeeded**, which is what makes the sender the
  only suspect: production validated the same document against the same rules
  and passed.

Giving the playground company a profile that matches is not an alternative — a
company either has a VAT number or it does not, and the recordings come from
both kinds.

## Improvements: when the recording is the thing that is wrong

A recording is a snapshot of how the API behaved on the day it was made, not a
specification of how it should behave. So every deliberate improvement to what
the API accepts looks exactly like a regression from here — the first NLCIUS
document we learned to recognise turned a recorded `400` into a `200`, and the
suite duly failed on it.

Those changes are written down in `improvements.ts`, ideally in the same commit
that makes them:

```ts
{
  reason:
    "NLCIUS (SI-UBL 2.0) documents are recognised now. Sending one as raw XML used to be refused because its format could not be detected.",
  since: "2026-08-17",
  matches: (recording) =>
    recording.responseStatus === 400 &&
    typeof recording.request?.document === "string" &&
    recording.request.document.includes("urn:fdc:nen.nl:nlcius:v1.0"),
  allows: (status) => status === 200,
}
```

Two things keep an entry from becoming a blind spot:

- **It says what the new answer is.** A recording it covers is not exempt from
  the suite; it is held to `allows` instead of to the recorded status, and
  anything else fails, naming the entry. An improvement that later regresses is
  therefore still caught.
- **It expires.** Only recordings captured before `since` are covered, so from
  the day the change ships every new recording is compared strictly again. Once
  the oldest recording in the bucket is younger than `since`, the entry is dead
  and can be deleted — which is the moment to delete it.

Match on the **kind** of recording — the customization id in the document, the
doctype id, the shape of the answer — and never on a recording id. One
improvement covers every recording of its kind, and there will be more of them
in the bucket tomorrow than there are today.

An improvement is the right tool only when the API's answer changed on purpose.
A recording that fails because of the environment it is replayed in belongs in
the masks or in `networkDecidedOutcome` instead.

## What a failure means

The suite calls the external validation service once per document and the PDF
renderer once per generated PDF, exactly as a real send does, so an outage in
either shows up as a wave of failures that are not regressions.

The XML comparison prints the first differing lines rather than two documents,
so a mismatch is readable at a glance:

```
error: The transmitted XML changed:
  59 recorded:     <cbc:PayableAmount currencyID="EUR">121.00</cbc:PayableAmount>
  59 replayed:     <cbc:PayableAmount currencyID="EUR">999.00</cbc:PayableAmount>
```

## What it costs

Every recording is read from the bucket before the first test runs, sixteen at
a time, retrying a read up to three times. Asking for a thousand objects at
once instead gets the connections closed underneath the run (`S3Error:
ConnectionClosed`).

An object that still will not read after its three attempts does not end the
run. It becomes a single failing test named `<key> (could not be read)`, and
everything else is replayed as usual. This matters because loading happens
while the module is being evaluated: an error thrown there aborts the run
before a single replay has happened, which is a poor trade for one bad object
out of a thousand.

If one keeps failing, check whether the bucket still has it: a `stat()` that
returns a size and an etag while both the S3 client and a presigned plain HTTP
`GET` close the socket means the metadata survived and the body did not. That
is data loss at the provider, not something this suite can work around — delete
the object, since there is nothing left in it to replay, and see whether
neighbouring keys of the same age read fine before assuming it is isolated.

Then one send per recording, plus one fetch of the stored document. Each send stores
a document in the playground, calls the validation service, renders a PDF when
the recorded request asked for one, and mails the blackhole address when the
recorded request asked for email — which still counts towards your Postmark
volume. `REGRESSION_RECORDING_LIMIT` is what keeps a run bounded: at the
default of 1000, expect a run in the tens of minutes and 1000 documents in the
playground. Lower it, or narrow `REGRESSION_RECORDING_PREFIX` to one company or
one day, while iterating.
