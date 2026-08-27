import { useState, useEffect, useMemo, useRef } from "react";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Textarea } from "@core/components/ui/textarea";
import { Button } from "@core/components/ui/button";
import { LineItemsEditor } from "./line-items-editor";
import { PartyForm } from "./party-form";
import { PaymentMeansForm } from "./payment-means-form";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@core/components/ui/collapsible";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import type { CreditNote } from "@peppol/utils/parsing/creditnote/schemas";
import type { Party } from "@peppol/utils/parsing/invoice/schemas";
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

interface CreditNoteFormProps {
  document: any;
  onChange: (document: any) => void;
  companyId: string;
  isSelfBilling?: boolean;
  customerParty?: Party;
  mode: "billing" | "developer";
  groupedCounterpartyKey: "buyer" | "seller" | null;
}

export function CreditNoteForm({
  document,
  onChange,
  companyId,
  isSelfBilling = false,
  customerParty,
  mode,
  groupedCounterpartyKey,
}: CreditNoteFormProps) {
  const { t } = useTranslation();
  const activeTeam = useActiveTeam();
  const [creditNote, setCreditNote] = useState<Partial<CreditNote>>({
    creditNoteNumber: "",
    issueDate: format(new Date(), "yyyy-MM-dd"),
    lines: [],
    invoiceReferences: [],
    attachments: [],
    ...document,
  });
  const [openSections, setOpenSections] = useState(() => ({
    buyer: false,
    seller: false,
    payment: mode === "billing",
    notes: false,
    lines: true,
    creditedInvoices: false,
    attachments: false,
  }));
  const lastAutoCreditNoteNumberRef = useRef<string | null>(null);
  const lastAutoIbanRef = useRef<string | null>(null);
  useEffect(() => {
    setCreditNote({
      creditNoteNumber: "",
      issueDate: format(new Date(), "yyyy-MM-dd"),
      lines: [],
      invoiceReferences: [],
      attachments: [],
    });
    lastAutoCreditNoteNumberRef.current = null;
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

          setCreditNote((prev) => ({
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
        ? DocumentType.SELF_BILLING_CREDIT_NOTE
        : DocumentType.CREDIT_NOTE;

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

        setCreditNote((prev) => {
          let next = prev;

          // Handle credit note number suggestion
          const currentNumber = (prev.creditNoteNumber || "").trim();
          const shouldAutoNumber =
            !currentNumber ||
            currentNumber === lastAutoCreditNoteNumberRef.current;

          if (suggestedNumber) {
            if (shouldAutoNumber && currentNumber !== suggestedNumber) {
              lastAutoCreditNoteNumberRef.current = suggestedNumber;
              next = { ...next, creditNoteNumber: suggestedNumber };
            }
          } else if (
            suggestedNumberRaw === null &&
            lastAutoCreditNoteNumberRef.current &&
            currentNumber === lastAutoCreditNoteNumberRef.current
          ) {
            // Clear auto-filled number when no suggestion available
            lastAutoCreditNoteNumberRef.current = null;
            next = { ...next, creditNoteNumber: "" };
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
    onChange(creditNote);
  }, [creditNote]);

  useEffect(() => {
    if (!document || typeof document !== "object") {
      return;
    }
    const doc: any = document;
    setCreditNote((prev) => {
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
    setCreditNote((prev) => ({
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

  const handleFieldChange = (field: keyof CreditNote, value: any) => {
    setCreditNote((prev) => ({ ...prev, [field]: value }));
  };

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const showBuyerOutsideGroup =
    mode === "developer" && groupedCounterpartyKey === "seller";
  const showSellerOutsideGroup =
    mode === "developer" && groupedCounterpartyKey === "buyer";

  const requiresExemptionReason = useMemo(() => {
    return (creditNote.lines || []).some(
      (line) => line.vat && isTaxExemptionReasonRequired(line.vat.category)
    );
  }, [creditNote.lines]);

  useEffect(() => {
    if (
      !requiresExemptionReason &&
      creditNote.vat &&
      typeof creditNote.vat === "object" &&
      "exemptionReason" in creditNote.vat
    ) {
      setCreditNote((prev) => {
        const { vat, ...rest } = prev;
        return rest;
      });
    }
  }, [requiresExemptionReason]);

  const handleVatExemptionReasonChange = (value: string) => {
    setCreditNote((prev) => ({
      ...prev,
      vat: value.trim() ? ({ exemptionReason: value } as any) : undefined,
    }));
  };

  const vatExemptionReason =
    creditNote.vat &&
    typeof creditNote.vat === "object" &&
    "exemptionReason" in creditNote.vat
      ? (creditNote.vat.exemptionReason as string) || ""
      : "";

  return (
    <div className="space-y-6">
      <div className="grid gap-4">
        <div>
          <Label htmlFor="creditNoteNumber">{t`Credit Note Number *`}</Label>
          <Input
            id="creditNoteNumber"
            value={creditNote.creditNoteNumber || ""}
            onChange={(e) =>
              handleFieldChange("creditNoteNumber", e.target.value)
            }
            placeholder="CN-2026-001"
            required
          />
        </div>

        <div>
          <Label htmlFor="issueDate">{t`Issue Date`}</Label>
          <Input
            id="issueDate"
            type="date"
            value={creditNote.issueDate || ""}
            onChange={(e) =>
              handleFieldChange(
                "issueDate",
                e.target.value?.trim() ? e.target.value.trim() : null
              )
            }
          />
        </div>

        <div>
          <Label htmlFor="buyerReference">{t`Buyer Reference`}</Label>
          <Input
            id="buyerReference"
            value={creditNote.buyerReference || ""}
            onChange={(e) =>
              handleFieldChange("buyerReference", e.target.value)
            }
            placeholder={t`An identifier assigned by the buyer for internal routing purposes.`}
          />
        </div>
      </div>

      <Collapsible open={openSections.creditedInvoices}>
        <CollapsibleTrigger
          className="flex w-full items-center justify-between py-2 font-medium transition-colors hover:text-primary"
          onClick={() => toggleSection("creditedInvoices")}
        >
          <span>{t`Credited Invoices`}</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${openSections.creditedInvoices ? "rotate-180" : ""}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4">
          <div className="space-y-4">
            {(creditNote.invoiceReferences || []).map((ref, index) => (
              <div key={index} className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label htmlFor={`invoiceRef-${index}-id`}>{t`Invoice ID *`}</Label>
                  <Input
                    id={`invoiceRef-${index}-id`}
                    value={ref.id || ""}
                    onChange={(e) => {
                      const newRefs = [...(creditNote.invoiceReferences || [])];
                      newRefs[index] = { ...ref, id: e.target.value };
                      handleFieldChange("invoiceReferences", newRefs);
                    }}
                    placeholder="INV-2024-001"
                  />
                </div>
                <div className="flex-1">
                  <Label htmlFor={`invoiceRef-${index}-date`}>{t`Issue Date`}</Label>
                  <Input
                    id={`invoiceRef-${index}-date`}
                    type="date"
                    value={ref.issueDate || ""}
                    onChange={(e) => {
                      const newRefs = [...(creditNote.invoiceReferences || [])];
                      newRefs[index] = {
                        ...ref,
                        issueDate:
                          e.target.value.length > 0
                            ? e.target.value.trim()
                            : null,
                      };
                      handleFieldChange("invoiceReferences", newRefs);
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const newRefs = (creditNote.invoiceReferences || []).filter(
                      (_, i) => i !== index
                    );
                    handleFieldChange("invoiceReferences", newRefs);
                  }}
                  className="ml-2"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const newRefs = [
                  ...(creditNote.invoiceReferences || []),
                  { id: "", issueDate: null },
                ];
                handleFieldChange("invoiceReferences", newRefs);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t`Add Invoice Reference`}
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>

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
              party={creditNote.buyer || {}}
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
              party={creditNote.seller || {}}
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
          <span>{t`Credit Note Lines *`}</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${openSections.lines ? "rotate-180" : ""}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4">
          <LineItemsEditor
            lines={creditNote.lines || []}
            onChange={(lines) => handleFieldChange("lines", lines)}
            isCreditNote
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
            placeholder={t`Reason why the credit note is exempt from VAT`}
            rows={3}
            required
          />
        </div>
      )}

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
            paymentMeans={creditNote.paymentMeans || []}
            onChange={(paymentMeans) =>
              handleFieldChange("paymentMeans", paymentMeans)
            }
          />
        </CollapsibleContent>
      </Collapsible>

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
            attachments={creditNote.attachments || []}
            onChange={(attachments) =>
              handleFieldChange("attachments", attachments)
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
              value={creditNote.note || ""}
              onChange={(e) => handleFieldChange("note", e.target.value)}
              placeholder={t`Reason for credit note`}
              rows={3}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
