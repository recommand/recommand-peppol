import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { validateXmlDocument } from "../data/validation/client";
import { getValidationProfile, documentFormats } from "../utils/type-repository/document-formats";
import { facturxFranceFormat } from "../utils/type-repository/document-formats/facturx-france";
import { validateDocument } from "../utils/pipelines/sending/validate-document";

describe("validation profile", () => {
  it("names the French rules for every French invoice format and nothing for other formats", () => {
    const expected: Record<string, string> = {
      "facturx-france": "fr-facturx",
      "ubl-france-cius-invoice": "fr-cius",
      "ubl-france-cius-creditnote": "fr-cius",
      "cii-d22b-france-cius": "fr-cius",
      "ubl-france-extended-invoice": "fr-extended",
      "ubl-france-extended-creditnote": "fr-extended",
      "cii-d22b-france-extended": "fr-extended",
    };
    for (const format of documentFormats) {
      expect({ format: format.key, profile: getValidationProfile(format.docTypeId) }).toEqual({
        format: format.key,
        profile: expected[format.key] as any,
      });
    }
    expect(getValidationProfile(facturxFranceFormat.docTypeId)).toBe("fr-facturx");
    expect(getValidationProfile("unknown-doc-type-id")).toBeUndefined();
  });

  describe("requests to the validation service", () => {
    const requests: URL[] = [];
    let server: ReturnType<typeof Bun.serve>;
    let previousUrl: string | undefined;

    beforeAll(() => {
      // Answers like the validation service: the French rules refuse the document only
      // when the French Factur-X profile is asked for.
      server = Bun.serve({
        port: 0,
        fetch(request) {
          const url = new URL(request.url);
          requests.push(url);
          return Response.json(
            url.searchParams.get("profile") === "fr-facturx"
              ? {
                  result: "invalid",
                  errors: [
                    {
                      ruleCode: "BR-FR-16_BT-119",
                      errorMessage: "Le taux de TVA doit faire partie des valeurs autorisées.",
                      errorLevel: "fatal_error",
                      fieldName: "/rsm:CrossIndustryInvoice[1]",
                      source: "schematron",
                    },
                  ],
                }
              : { result: "valid", errors: [] }
          );
        },
      });
      previousUrl = process.env.VALIDATION_SERVICE_URL;
      process.env.VALIDATION_SERVICE_URL = `http://localhost:${server.port}/validate`;
    });

    afterAll(() => {
      if (previousUrl === undefined) {
        delete process.env.VALIDATION_SERVICE_URL;
      } else {
        process.env.VALIDATION_SERVICE_URL = previousUrl;
      }
      server.stop(true);
    });

    it("names the profile only when one is given", async () => {
      requests.length = 0;
      await validateXmlDocument("<a/>");
      await validateXmlDocument("<a/>", { profile: "fr-facturx" });

      expect(requests.map((url) => url.pathname)).toEqual(["/validate", "/validate"]);
      expect(requests.map((url) => url.searchParams.get("profile"))).toEqual([null, "fr-facturx"]);
    });

    it("refuses a French Factur-X send that fails the French rules", async () => {
      await expect(validateDocument("<a/>", facturxFranceFormat.docTypeId)).rejects.toThrow(
        "Document validation failed"
      );
      const cii = documentFormats.find((format) => format.key === "cii-d22b-en16931");
      expect(cii).toBeDefined();
      await expect(validateDocument("<a/>", cii!.docTypeId)).resolves.toMatchObject({ result: "valid" });
    });

    it("names the French profile of the doc type when sending French UBL and CII", async () => {
      requests.length = 0;
      for (const key of ["ubl-france-cius-invoice", "cii-d22b-france-extended"]) {
        const format = documentFormats.find((candidate) => candidate.key === key);
        expect(format).toBeDefined();
        await validateDocument("<a/>", format!.docTypeId);
      }

      expect(requests.map((url) => url.searchParams.get("profile"))).toEqual(["fr-cius", "fr-extended"]);
    });
  });
});
