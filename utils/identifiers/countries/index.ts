import type { CountryIdentifierRules } from "../validators";
import { australia } from "./australia";
import { austria } from "./austria";
import { belgium } from "./belgium";
import { bulgaria } from "./bulgaria";
import { croatia } from "./croatia";
import { cyprus } from "./cyprus";
import { denmark } from "./denmark";
import { estonia } from "./estonia";
import { finland } from "./finland";
import { france } from "./france";
import { germany } from "./germany";
import { greece } from "./greece";
import { hungary } from "./hungary";
import { iceland } from "./iceland";
import { ireland } from "./ireland";
import { italy } from "./italy";
import { latvia } from "./latvia";
import { luxembourg } from "./luxembourg";
import { netherlands } from "./netherlands";
import { norway } from "./norway";
import { poland } from "./poland";
import { portugal } from "./portugal";
import { romania } from "./romania";
import { slovakia } from "./slovakia";
import { slovenia } from "./slovenia";
import { spain } from "./spain";
import { sweden } from "./sweden";
import { unitedKingdom } from "./united-kingdom";

/** The identifier rules of every country that has them. */
export const countryIdentifierRules: readonly CountryIdentifierRules[] = [
  australia,
  austria,
  belgium,
  bulgaria,
  croatia,
  cyprus,
  denmark,
  estonia,
  finland,
  france,
  germany,
  greece,
  hungary,
  iceland,
  ireland,
  italy,
  latvia,
  luxembourg,
  netherlands,
  norway,
  poland,
  portugal,
  romania,
  slovakia,
  slovenia,
  spain,
  sweden,
  unitedKingdom,
];

export function getCountryIdentifierRules(country: string | null | undefined): CountryIdentifierRules | undefined {
  return countryIdentifierRules.find((rules) => rules.country === country?.toUpperCase());
}
