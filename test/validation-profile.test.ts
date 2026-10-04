import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { validateXmlDocument } from "../data/validation/client";
import { getValidationProfile, documentFormats } from "../utils/type-repository/document-formats";
import { facturxFranceFormat } from "../utils/type-repository/document-formats/facturx-france";
import { validateDocument } from "../utils/pipelines/sending/validate-document";

describe("validation profile", () => {
  it("is fr-facturx for French Factur-X and absent for every other format", () => {
    expect(getValidationProfile(facturxFranceFormat.docTypeId)).toBe("fr-facturx");
    for (const format of documentFormats) {
      if (format !== facturxFranceFormat) {
        expect(getValidationProfile(format.docTypeId)).toBeUndefined();
      }
    }
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
  });
});
