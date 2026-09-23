import { useEffect, useState } from "react";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@core/components/ui/card";
import { Label } from "@core/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@core/components/ui/select";
import { AsyncButton } from "@core/components/async-button";
import { toast } from "@core/components/ui/sonner";
import { useTranslation } from "@core/hooks/use-translation";
import { rc } from "@recommand/lib/client";
import { stringifyActionFailure } from "@recommand/lib/utils";
import type { FrenchReporting } from "@peppol/api/reporting";
import { Landmark } from "lucide-react";

const client = rc<FrenchReporting>("v1");

type VatRegime = "REEL_NORMAL_MENSUEL" | "REEL_SIMPLIFIE" | "FRANCHISE_EN_BASE";
type VatExigibility = "ENCAISSEMENTS" | "DEBITS";

type Declarant = {
  environment: "PROD" | "TEST";
  siren: string;
  issuerName: string;
  vatRegime: VatRegime;
  vatExigibility: VatExigibility;
  enabled: boolean;
  state: "pending" | "registered" | "blocked";
  simulated: boolean;
  lastError: string | null;
  registeredAt: string | null;
};

type CompanyFrenchReportingManagerProps = {
  companyId: string;
  isVerified: boolean;
};

/**
 * Registers a French company as an e-reporting declarant and shows where that
 * registration stands. Reports themselves are submitted through the API.
 */
export function CompanyFrenchReportingManager({ companyId, isVerified }: CompanyFrenchReportingManagerProps) {
  const { t } = useTranslation();
  const [declarant, setDeclarant] = useState<Declarant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [vatRegime, setVatRegime] = useState<VatRegime | "">("");
  const [vatExigibility, setVatExigibility] = useState<VatExigibility | "">("");

  const regimeLabels: Record<VatRegime, string> = {
    REEL_NORMAL_MENSUEL: t`Régime réel normal (monthly)`,
    REEL_SIMPLIFIE: t`Régime réel simplifié`,
    FRANCHISE_EN_BASE: t`Franchise en base de TVA`,
  };
  const exigibilityLabels: Record<VatExigibility, string> = {
    DEBITS: t`On invoicing (TVA sur les débits)`,
    ENCAISSEMENTS: t`On payment (TVA sur les encaissements)`,
  };

  useEffect(() => {
    fetchDeclarant();
  }, [companyId]);

  const fetchDeclarant = async () => {
    try {
      setIsLoading(true);
      const response = await client[":companyId"]["reporting"]["fr"]["declarant"].$get({
        param: { companyId },
      });
      const json = await response.json();
      if (!json.success) {
        toast.error(t`Failed to load the e-reporting registration`);
        return;
      }
      setDeclarant(json.declarant);
      if (json.declarant) {
        setVatRegime(json.declarant.vatRegime);
        setVatExigibility(json.declarant.vatExigibility);
      }
    } catch (error) {
      console.error("Error fetching French reporting registration:", error);
      toast.error(t`Failed to load the e-reporting registration`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!vatRegime || !vatExigibility) {
      toast.error(t`Choose the VAT regime and when VAT becomes due first`);
      return;
    }
    try {
      const response = await client[":companyId"]["reporting"]["fr"]["declarant"].$put({
        param: { companyId },
        json: { vatRegime, vatExigibility },
      });
      const json = await response.json();
      if (!json.success) {
        toast.error(stringifyActionFailure(json.errors));
        return;
      }
      setDeclarant(json.declarant);
      setIsEditing(false);
      if (json.declarant.state === "registered") {
        toast.success(t`The company is registered for French e-reporting`);
      } else if (json.declarant.state === "pending") {
        toast.info(t`The registration is being completed in the background`);
      } else {
        toast.error(t`The registration needs support; see the details below`);
      }
    } catch (error) {
      console.error("Error registering for French reporting:", error);
      toast.error(t`Failed to register the company for e-reporting`);
    }
  };

  const stateBadge = (state: Declarant["state"], enabled: boolean) => {
    if (!enabled) {
      return <Badge variant="secondary">{t`Suspended`}</Badge>;
    }
    switch (state) {
      case "registered":
        return <Badge>{t`Registered`}</Badge>;
      case "pending":
        return <Badge variant="secondary">{t`Pending`}</Badge>;
      case "blocked":
        return <Badge variant="destructive">{t`Needs support`}</Badge>;
    }
  };

  const form = (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>{t`VAT regime`}</Label>
          <Select value={vatRegime} onValueChange={(value) => setVatRegime(value as VatRegime)}>
            <SelectTrigger>
              <SelectValue placeholder={t`Select the VAT regime`} />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(regimeLabels) as VatRegime[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {regimeLabels[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t`The regime determines how often the reports are filed with the tax administration.`}
          </p>
        </div>
        <div className="space-y-2">
          <Label>{t`VAT becomes due`}</Label>
          <Select
            value={vatExigibility}
            onValueChange={(value) => setVatExigibility(value as VatExigibility)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t`Select when VAT becomes due`} />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(exigibilityLabels) as VatExigibility[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {exigibilityLabels[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t`Payment reports are only filed when VAT becomes due on payment.`}
          </p>
        </div>
      </div>
      {declarant && (
        <p className="text-xs text-muted-foreground">
          {t`Changing the regime during a reporting period can leave that period unfiled. Coordinate such a change with support.`}
        </p>
      )}
      <div className="flex gap-2">
        <AsyncButton onClick={handleRegister} disabled={!isVerified && !declarant?.simulated}>
          {declarant ? t`Update registration` : t`Register for e-reporting`}
        </AsyncButton>
        {declarant && (
          <Button variant="outline" onClick={() => setIsEditing(false)}>
            {t`Cancel`}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-primary/10 p-2 mt-0.5">
            <Landmark className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1">
            <CardTitle>{t`French e-reporting`}</CardTitle>
            <CardDescription>
              {t`Daily B2C totals and cross-border invoices are reported to the French tax administration on the company's behalf. Register the company once, then submit reports through the API.`}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t`Loading...`}</p>
        ) : !declarant || isEditing ? (
          <div className="space-y-4">
            {!declarant && !isVerified && (
              <p className="text-sm text-muted-foreground">
                {t`Verify the company first. The signed French mandate is what allows us to report on its behalf.`}
              </p>
            )}
            {form}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {stateBadge(declarant.state, declarant.enabled)}
              {declarant.simulated && <Badge variant="outline">{t`Simulated`}</Badge>}
              <span className="text-sm text-muted-foreground">
                {t`SIREN ${declarant.siren}`}
              </span>
            </div>
            <dl className="grid gap-2 text-sm md:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t`VAT regime`}</dt>
                <dd>{regimeLabels[declarant.vatRegime]}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t`VAT becomes due`}</dt>
                <dd>{exigibilityLabels[declarant.vatExigibility]}</dd>
              </div>
            </dl>
            {declarant.state === "pending" && (
              <p className="text-sm text-muted-foreground">
                {t`The registration is being completed with our French reporting partner. Reports can be submitted once it is registered.`}
              </p>
            )}
            {declarant.state === "blocked" && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <p className="font-medium">{t`The registration could not be completed.`}</p>
                <p className="text-muted-foreground">
                  {t`Our support team has been notified and will contact you. You can also reach us at support@recommand.eu.`}
                </p>
                {declarant.lastError && (
                  <p className="mt-2 font-mono text-xs text-muted-foreground">{declarant.lastError}</p>
                )}
              </div>
            )}
            {declarant.simulated && (
              <p className="text-sm text-muted-foreground">
                {t`Playground and test-network teams do not file with the tax administration. Reports are accepted and recorded, but simulated.`}
              </p>
            )}
            <Button variant="outline" onClick={() => setIsEditing(true)}>
              {t`Change VAT settings`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
