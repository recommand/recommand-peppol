import { useState, useEffect, useMemo, useRef } from "react";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Textarea } from "@core/components/ui/textarea";
import { LineItemsEditor } from "./line-items-editor";
import { PartyForm } from "./party-form";
import { PaymentMeansForm } from "./payment-means-form";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@core/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import type { Invoice, Party } from "@peppol/utils/parsing/invoice/schemas";
import { format } from "date-fns";
import { useTranslation } from "@core/hooks/use-translation";
import { rc } from "@recommand/lib/client";
import type { Companies } from "@peppol/api/companies";
import { useActiveTeam } from "@core/hooks/user";
import { AttachmentsEditor } from "./attachments-editor";
import { isTaxExemptionReasonRequired } from "@peppol/utils/parsing/invoice/calculations";
import type { DocumentDefaults } from "@peppol/api/document-defaults";
import { DocumentType } from "@peppol/utils/parsing/send-document";

const companiesClient = rc<Companies>("peppol");
const sendDocumentClient = rc<DocumentDefaults>("peppol");

interface InvoiceFormProps {
  document: any;
  onChange: (document: any) => void;
  companyId: string;
  isSelfBilling?: boolean;
  customerParty?: Party;
  mode: "billing" | "developer";
  groupedCounterpartyKey: "buyer" | "seller" | null;
}

export function InvoiceForm({
  document,
  onChange,
  companyId,
  isSelfBilling = false,
  customerParty,
  mode,
  groupedCounterpartyKey,
}: InvoiceFormProps) {
  const { t } = useTranslation();
  const activeTeam = useActiveTeam();
  const [invoice, setInvoice] = useState<Partial<Invoice>>({
    invoiceNumber: "",
    issueDate: format(new Date(), "yyyy-MM-dd"),
    dueDate: format(
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      "yyyy-MM-dd"
    ),
    lines: [],
    attachments: [],
    ...document,
  });
  const [openSections, setOpenSections] = useState(() => ({
    buyer: false,
    seller: false,
    payment: mode === "billing",
    notes: false,
    lines: true,
    attachments: false,
  }));
  const lastAutoInvoiceNumberRef = useRef<string | null>(null);
  const lastAutoIbanRef = useRef<string | null>(null);
  useEffect(() => {
    setInvoice({
      invoiceNumber: "",
      issueDate: format(new Date(), "yyyy-MM-dd"),
      dueDate: format(
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        "yyyy-MM-dd"
      ),
      lines: [],
      attachments: [],
    });
    lastAutoInvoiceNumberRef.current = null;
    lastAutoIbanRef.current = null;
  }, [activeTeam?.id, companyId]);

  const isSameParty = (a: any, b: any) => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return (
      a.name === b.name &&
      a.street === b.street &&
      a.street2 === b.street2 &&
      a.city === b.city &&
      a.postalZone === b.postalZone &&
      a.country === b.country &&
      a.vatNumber === b.vatNumber &&
      a.enterpriseNumber === b.enterpriseNumber &&
      a.email === b.email &&
      a.phone === b.phone
    );
  };

  // Auto-populate company info when company changes
  useEffect(() => {
    const loadCompanyInfo = async () => {
      if (!companyId || !activeTeam?.id) return;

      try {
        const response = await companiesClient[":teamId"]["companies"][
          ":companyId"
        ].$get({
          param: { teamId: activeTeam.id, companyId },
        });
        const json = await response.json();

        if (json.success && json.company) {
          const company = json.company;
          const companyInfo = {
            vatNumber: company.vatNumber || "",
            enterpriseNumber: company.enterpriseNumber || null,
            enterpriseNumberScheme: company.enterpriseNumberScheme || null,
            name: company.name,
            street: company.address,
            city: company.city,
            postalZone: company.postalCode,
            country: company.country,
            email: company.email || null,
            phone: company.phone || null,
          };

          setInvoice((prev) => ({
            ...prev,
            ...(isSelfBilling
              ? { buyer: companyInfo }
              : { seller: companyInfo }),
          }));
        }
      } catch (error) {
        console.error("Failed to load company info:", error);
      }
    };

    loadCompanyInfo();
  }, [companyId, activeTeam?.id, isSelfBilling]);

  useEffect(() => {
    const run = async () => {
      if (!companyId) return;

      const documentType = isSelfBilling
        ? DocumentType.SELF_BILLING_INVOICE
        : DocumentType.INVOICE;

      try {
        const response = await sendDocumentClient[":companyId"][
          "documentDefaults"
        ].$get({
          param: { companyId },
          query: { documentType },
        });
        const json: any = await response.json();
        if (!json?.success) return;

        const suggestedNumberRaw = json?.documentNumber;
        const suggestedNumber =
          typeof suggestedNumberRaw === "string"
            ? suggestedNumberRaw.trim()
            : "";

        const suggestedIbanRaw = json?.iban;
        const suggestedIban =
          typeof suggestedIbanRaw === "string" ? suggestedIbanRaw.trim() : "";

        setInvoice((prev) => {
          let next = prev;

          // Handle invoice number suggestion
          const currentNumber = (prev.invoiceNumber || "").trim();
          const shouldAutoNumber =
            !currentNumber ||
            currentNumber === lastAutoInvoiceNumberRef.current;

          if (suggestedNumber) {
            if (shouldAutoNumber && currentNumber !== suggestedNumber) {
              lastAutoInvoiceNumberRef.current = suggestedNumber;
              next = { ...next, invoiceNumber: suggestedNumber };
            }
          } else if (
            suggestedNumberRaw === null &&
            lastAutoInvoiceNumberRef.current &&
            currentNumber === lastAutoInvoiceNumberRef.current
          ) {
            // Clear auto-filled number when no suggestion available
            lastAutoInvoiceNumberRef.current = null;
            next = { ...next, invoiceNumber: "" };
          }

          // Handle IBAN suggestion
          const pm = Array.isArray(prev.paymentMeans) ? prev.paymentMeans : [];
          const currentIbans = pm
            .map((p: any) => (typeof p?.iban === "string" ? p.iban.trim() : ""))
            .filter(Boolean);
          const currentIban = currentIbans[0] ?? "";
          const shouldAutoIban =
            currentIbans.length === 0 ||
            currentIban === lastAutoIbanRef.current;

          if (suggestedIban) {
            if (shouldAutoIban && currentIban !== suggestedIban) {
              lastAutoIbanRef.current = suggestedIban;
              const nextPaymentMeans =
                pm.length === 0
                  ? [
                      {
                        paymentMethod: "credit_transfer",
                        reference: "",
                        iban: suggestedIban,
                      },
                    ]
                  : pm.map((p: any, idx: number) =>
                      idx === 0 ? { ...p, iban: suggestedIban } : p
                    );
              next = { ...next, paymentMeans: nextPaymentMeans as any };
            }
          } else if (
            suggestedIbanRaw === null &&
            lastAutoIbanRef.current &&
            currentIban === lastAutoIbanRef.current
          ) {
            // Clear auto-filled IBAN when no suggestion available
            lastAutoIbanRef.current = null;
            const nextPaymentMeans = pm.map((p: any, idx: number) =>
              idx === 0 ? { ...p, iban: "" } : p
            );
            next = { ...next, paymentMeans: nextPaymentMeans as any };
          }

          return next;
        });
      } catch {
        return;
      }
    };

    run();
  }, [companyId, isSelfBilling, mode]);

  useEffect(() => {
    onChange(invoice);
  }, [invoice]);

  useEffect(() => {
    if (!document || typeof document !== "object") {
      return;
    }
    const doc: any = document;
    setInvoice((prev) => {
      const nextBuyer = doc.buyer;
      const nextSeller = doc.seller;
      let next = prev;
      if (nextBuyer && !isSameParty(prev.buyer, nextBuyer)) {
        next = { ...next, buyer: nextBuyer };
      }
      if (nextSeller && !isSameParty(prev.seller, nextSeller)) {
        next = { ...next, seller: nextSeller };
      }
      return next;
    });
  }, [document]);

  useEffect(() => {
    if (!customerParty) return;
    setInvoice((prev) => ({
      ...prev,
      ...(isSelfBilling
        ? prev.seller?.name === customerParty.name &&
          prev.seller?.street === customerParty.street &&
          prev.seller?.postalZone === customerParty.postalZone &&
          prev.seller?.country === customerParty.country
          ? {}
          : { seller: customerParty }
        : prev.buyer?.name === customerParty.name &&
            prev.buyer?.street === customerParty.street &&
            prev.buyer?.postalZone === customerParty.postalZone &&
            prev.buyer?.country === customerParty.country
          ? {}
          : { buyer: customerParty }),
    }));
  }, [customerParty, isSelfBilling]);

  useEffect(() => {
    if (mode !== "billing") {
      return;
    }
    setOpenSections((prev) => ({
      ...prev,
      payment: true,
      attachments: false,
    }));
  }, [mode]);

  const handleFieldChange = (field: keyof Invoice, value: any) => {
    setInvoice((prev) => ({ ...prev, [field]: value }));
  };

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const showBuyerOutsideGroup =
    mode === "developer" && groupedCounterpartyKey === "seller";
  const showSellerOutsideGroup =
    mode === "developer" && groupedCounterpartyKey === "buyer";

  const requiresExemptionReason = useMemo(() => {
    return (invoice.lines || []).some(
      (line) => line.vat && isTaxExemptionReasonRequired(line.vat.category)
    );
  }, [invoice.lines]);

  useEffect(() => {
    if (
      !requiresExemptionReason &&
      invoice.vat &&
      typeof invoice.vat === "object" &&
      "exemptionReason" in invoice.vat
    ) {
      setInvoice((prev) => {
        const { vat, ...rest } = prev;
        return rest;
      });
    }
  }, [requiresExemptionReason]);

  const handleVatExemptionReasonChange = (value: string) => {
    setInvoice((prev) => ({
      ...prev,
      vat: value.trim() ? ({ exemptionReason: value } as any) : undefined,
    }));
  };

  const vatExemptionReason =
    invoice.vat &&
    typeof invoice.vat === "object" &&
    "exemptionReason" in invoice.vat
      ? (invoice.vat.exemptionReason as string) || ""
      : "";

  return (
    <div className="space-y-6">
      <div className="grid gap-4">
        <div>
          <Label htmlFor="invoiceNumber">{t`Invoice Number *`}</Label>
          <Input
            id="invoiceNumber"
            value={invoice.invoiceNumber || ""}
            onChange={(e) => handleFieldChange("invoiceNumber", e.target.value)}
            placeholder="INV-2026-001"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="issueDate">{t`Issue Date`}</Label>
            <Input
              id="issueDate"
              type="date"
              value={invoice.issueDate || ""}
              onChange={(e) =>
                handleFieldChange(
                  "issueDate",
                  e.target.value?.trim() ? e.target.value.trim() : null
                )
              }
            />
          </div>
          <div>
            <Label htmlFor="dueDate">{t`Due Date`}</Label>
            <Input
              id="dueDate"
              type="date"
              value={invoice.dueDate || ""}
              onChange={(e) =>
                handleFieldChange(
                  "dueDate",
                  e.target.value?.trim() ? e.target.value.trim() : null
                )
              }
            />
          </div>
        </div>

        <div>
          <Label htmlFor="buyerReference">{t`Buyer Reference`}</Label>
          <Input
            id="buyerReference"
            value={invoice.buyerReference || ""}
            onChange={(e) =>
              handleFieldChange("buyerReference", e.target.value)
            }
            placeholder="PO-2026-001"
          />
        </div>
      </div>

      {showBuyerOutsideGroup && (
        <Collapsible open={openSections.buyer}>
          <CollapsibleTrigger
            className="flex w-full items-center justify-between py-2 font-medium transition-colors hover:text-primary"
            onClick={() => toggleSection("buyer")}
          >
            <span>
              {isSelfBilling
                ? t`Buyer Information (Auto-populated)`
                : t`Buyer Information *`}
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${openSections.buyer ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <PartyForm
              party={invoice.buyer || {}}
              onChange={(buyer) => handleFieldChange("buyer", buyer)}
              required={!isSelfBilling}
              disabled={isSelfBilling}
            />
          </CollapsibleContent>
        </Collapsible>
      )}

      {showSellerOutsideGroup && (
        <Collapsible open={openSections.seller}>
          <CollapsibleTrigger
            className="flex w-full items-center justify-between py-2 font-medium transition-colors hover:text-primary"
            onClick={() => toggleSection("seller")}
          >
            <span>
              {isSelfBilling
                ? t`Seller Information *`
                : t`Seller Information (Auto-populated)`}
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${openSections.seller ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <PartyForm
              party={invoice.seller || {}}
              onChange={(seller) => handleFieldChange("seller", seller)}
              required={isSelfBilling}
              disabled={!isSelfBilling}
            />
          </CollapsibleContent>
        </Collapsible>
      )}

      <Collapsible open={openSections.lines}>
        <CollapsibleTrigger
          className="flex w-full items-center justify-between py-2 font-medium transition-colors hover:text-primary"
          onClick={() => toggleSection("lines")}
        >
          <span>{t`Invoice Lines *`}</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${openSections.lines ? "rotate-180" : ""}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4">
          <LineItemsEditor
            lines={invoice.lines || []}
            onChange={(lines) => handleFieldChange("lines", lines)}
          />
        </CollapsibleContent>
      </Collapsible>

      {requiresExemptionReason && (
        <div>
          <Label htmlFor="vatExemptionReason">{t`VAT Exemption Reason *`}</Label>
          <Textarea
            id="vatExemptionReason"
            value={vatExemptionReason}
            onChange={(e) => handleVatExemptionReasonChange(e.target.value)}
            placeholder={t`Reason why the invoice is exempt from VAT`}
            rows={3}
            required
          />
        </div>
      )}

      <Collapsible open={openSections.attachments}>
        <CollapsibleTrigger
          className="flex w-full items-center justify-between py-2 font-medium transition-colors hover:text-primary"
          onClick={() => toggleSection("attachments")}
        >
          <span>{t`Attachments`}</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${openSections.attachments ? "rotate-180" : ""}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4">
          <AttachmentsEditor
            attachments={invoice.attachments || []}
            onChange={(attachments) =>
              handleFieldChange("attachments", attachments)
            }
          />
        </CollapsibleContent>
      </Collapsible>

      <Collapsible open={openSections.payment}>
        <CollapsibleTrigger
          className="flex w-full items-center justify-between py-2 font-medium transition-colors hover:text-primary"
          onClick={() => toggleSection("payment")}
        >
          <span>{t`Payment Information`}</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${openSections.payment ? "rotate-180" : ""}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4">
          <PaymentMeansForm
            paymentMeans={invoice.paymentMeans || []}
            onChange={(paymentMeans) =>
              handleFieldChange("paymentMeans", paymentMeans)
            }
          />
        </CollapsibleContent>
      </Collapsible>

      <Collapsible open={openSections.notes}>
        <CollapsibleTrigger
          className="flex w-full items-center justify-between py-2 font-medium transition-colors hover:text-primary"
          onClick={() => toggleSection("notes")}
        >
          <span>{t`Additional Notes`}</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${openSections.notes ? "rotate-180" : ""}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4">
          <div>
            <Label htmlFor="note">{t`Note`}</Label>
            <Textarea
              id="note"
              value={invoice.note || ""}
              onChange={(e) => handleFieldChange("note", e.target.value)}
              placeholder={t`Thank you for your business`}
              rows={3}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
