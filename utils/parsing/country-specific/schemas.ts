import { z } from "zod";
import "zod-openapi/extend";
import { frenchCountrySpecificSchema } from "./france";

export const countrySpecificSchema = z.discriminatedUnion("country", [
  frenchCountrySpecificSchema,
]).openapi({
  ref: "CountrySpecificBilling",
  description:
    "Country-specific structured billing requirements. Use the FR variant for French regulated UBL, CII, and Factur-X; omit this field for plain EN 16931 and other document types.",
});
