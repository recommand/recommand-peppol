# XRechnung 3.0.2 fixtures

Official XRechnung instances, published by KoSIT under the Apache License 2.0 and
stored byte for byte. `test/xrechnung.test.ts` uses them to check format detection,
parsing of received documents and raw XML sending.

| File | Source | What it is |
| --- | --- | --- |
| `01.01a-INVOICE_ubl.xml` | [xrechnung-testsuite `v2026-01-31`](https://github.com/itplr-kosit/xrechnung-testsuite/releases/tag/v2026-01-31), `instances/standard/` | XRechnung 3.0 UBL invoice |
| `01.01a-INVOICE_uncefact.xml` | same release, `instances/standard/` | XRechnung 3.0 CII invoice |
| `04.01a-INVOICE_ubl.xml` | same release, `instances/extension/` | XRechnung 3.0 extension UBL invoice, which is not a supported format |
| `ubl-cn-br-de-15-test.xml` | [xrechnung-schematron `v2.5.0`](https://github.com/itplr-kosit/xrechnung-schematron/tree/v2.5.0/test/instances/ubl-cn), `test/instances/ubl-cn/` | XRechnung 3.0 UBL credit note |

The test suite release targets XRechnung 3.0.2 with XRechnung Schematron 2.5.0 (KoSIT
validator configuration 2026-01-31). It contains no UBL credit note, so that one comes
from the Schematron's own test instances.
