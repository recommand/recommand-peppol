import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@core/components/ui/button";
import { Label } from "@core/components/ui/label";
import { toast } from "@core/components/ui/sonner";
import { rc } from "@recommand/lib/client";
import type { SendDocument } from "@peppol/utils/parsing/send-document";
import type { SendDocument as SendDocumentAPI } from "@peppol/api/send-document";
import { DocumentType } from "@peppol/utils/parsing/send-document";
import { InvoiceForm } from "./invoice-form";
import { CreditNoteForm } from "./credit-note-form";
import { XmlForm } from "./xml-form";
import { RecipientSelector } from "./recipient-selector";
import { CompanySelector } from "./company-selector";
import { EmailOptions } from "./email-options";
import { Loader2, Send } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { stringifyActionFailure } from "@recommand/lib/utils";
import { Card } from "@core/components/ui/card";
import { Switch } from "@core/components/ui/switch";
import { Input } from "@core/components/ui/input";
import {
  ensureFileExtension,
  getDocumentFilename,
} from "@peppol/utils/document-filename";
import { useActiveTeam } from "@core/hooks/user";
import type { Customers } from "@peppol/api/customers";
import type { Party } from "@peppol/utils/parsing/invoice/schemas";
import { Combobox } from "@core/components/ui/combobox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@core/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { PartyForm } from "./party-form";
import { useTranslation } from "@core/hooks/use-translation";

const client = rc<SendDocumentAPI>("peppol");
const customersClient = rc<Customers>("v1");

interface DocumentFormProps {
  type: "invoice" | "creditNote" | "xml";
  formData: Partial<SendDocument>;
  onFormChange: (data: Partial<SendDocument>) => void;
  selectedCompanyId: string;
  onCompanyChange: (companyId: string) => void;
  mode: "billing" | "developer";
}

export function DocumentForm({
  type,
  formData,
  onFormChange,
  selectedCompanyId,
  onCompanyChange,
  mode,
}: DocumentFormProps) {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const lastAutoPdfFilenameRef = useRef<string | null>(null);
  const lastAutoRecipientRef = useRef<string | null>(null);
  const activeTeam = useActiveTeam();
  const [customers, setCustomers] = useState<
    Array<{
      id: string;
      name: string;
      vatNumber: string | null;
      enterpriseNumber: string | null;
      peppolAddresses: string[];
      address: string;
      city: string;
      postalCode: string;
      country: string;
      email: string | null;
      phone: string | null;
    }>
  >([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [isCounterpartyOpen, setIsCounterpartyOpen] = useState(
    mode === "developer"
  );

  const getAutoPdfFilename = (): string | null => {
    const docType = formData.documentType;
    const doc: any = formData.document;
    if (
      docType === DocumentType.INVOICE ||
      docType === DocumentType.SELF_BILLING_INVOICE
    ) {
      const invoiceNumber =
        typeof doc?.invoiceNumber === "string" ? doc.invoiceNumber.trim() : "";
      if (!invoiceNumber) {
        return null;
      }
      const base = getDocumentFilename(docType, doc);
      return ensureFileExtension(base, "pdf");
    }
    if (
      docType === DocumentType.CREDIT_NOTE ||
      docType === DocumentType.SELF_BILLING_CREDIT_NOTE
    ) {
      const creditNoteNumber =
        typeof doc?.creditNoteNumber === "string"
          ? doc.creditNoteNumber.trim()
          : "";
      if (!creditNoteNumber) {
        return null;
      }
      const base = getDocumentFilename(docType, doc);
      return ensureFileExtension(base, "pdf");
    }
    return null;
  };

  useEffect(() => {
    if (!formData.pdfGeneration?.enabled) {
      return;
    }
    const auto = getAutoPdfFilename();
    if (!auto) {
      return;
    }
    const current = formData.pdfGeneration.filename;
    const isAuto =
      current === undefined || current === lastAutoPdfFilenameRef.current;
    if (!isAuto || current === auto) {
      return;
    }
    lastAutoPdfFilenameRef.current = auto;
    onFormChange({
      ...formData,
      pdfGeneration: { enabled: true, filename: auto },
    });
  }, [
    formData,
    formData.documentType,
    formData.document,
    formData.pdfGeneration?.enabled,
    formData.pdfGeneration?.filename,
    onFormChange,
  ]);

  useEffect(() => {
    const fetchCustomers = async () => {
      if (!activeTeam?.id) {
        setCustomers([]);
        return;
      }

      try {
        const response = await customersClient[":teamId"]["customers"].$get({
          param: { teamId: activeTeam.id },
          query: { page: 1, limit: 100 },
        });
        const json = await response.json();
        if (!json.success || !Array.isArray(json.customers)) {
          setCustomers([]);
          return;
        }
        setCustomers(
          json.customers.map((c: any) => ({
            id: c.id,
            name: c.name,
            vatNumber: c.vatNumber ?? null,
            enterpriseNumber: c.enterpriseNumber ?? null,
            peppolAddresses: Array.isArray(c.peppolAddresses)
              ? c.peppolAddresses
              : [],
            address: c.address,
            city: c.city,
            postalCode: c.postalCode,
            country: c.country,
            email: c.email ?? null,
            phone: c.phone ?? null,
          }))
        );
      } catch (error) {
        setCustomers([]);
      }
    };

    fetchCustomers();
  }, [activeTeam?.id]);

  const selectedCustomer = useMemo(() => {
    if (!selectedCustomerId || customers.length === 0) {
      return null;
    }
    return customers.find((c) => c.id === selectedCustomerId) ?? null;
  }, [customers, selectedCustomerId]);

  const customerParty: Party | undefined = useMemo(() => {
    if (!selectedCustomer) {
      return undefined;
    }
    return {
      name: selectedCustomer.name,
      street: selectedCustomer.address,
      street2: null,
      city: selectedCustomer.city,
      postalZone: selectedCustomer.postalCode,
      country: selectedCustomer.country,
      vatNumber: selectedCustomer.vatNumber,
      enterpriseNumber: selectedCustomer.enterpriseNumber,
      email: selectedCustomer.email,
      phone: selectedCustomer.phone,
    };
  }, [selectedCustomer]);

  const counterpartyKey: "buyer" | "seller" | null = useMemo(() => {
    if (type === "xml") return null;
    if (
      formData.documentType === DocumentType.SELF_BILLING_INVOICE ||
      formData.documentType === DocumentType.SELF_BILLING_CREDIT_NOTE
    ) {
      return "seller";
    }
    return "buyer";
  }, [formData.documentType, type]);

  const counterpartyLabel = useMemo(() => {
    return counterpartyKey === "seller" ? t`Seller details` : t`Buyer details`;
  }, [counterpartyKey, t]);

  const counterpartyParty: Party | undefined = useMemo(() => {
    if (!counterpartyKey) return undefined;
    const doc: any = formData.document;
    const party = doc?.[counterpartyKey];
    return party && typeof party === "object" ? (party as Party) : undefined;
  }, [counterpartyKey, formData.document]);

  const handleCounterpartyChange = (party: Party) => {
    if (!counterpartyKey) return;
    const doc: any = formData.document;
    if (!doc || typeof doc !== "object") return;
    onFormChange({
      ...formData,
      document: {
        ...doc,
        [counterpartyKey]: party,
      },
    });
  };

  useEffect(() => {
    if (!selectedCustomer) {
      lastAutoRecipientRef.current = null;
      return;
    }

    const autoRecipientRaw = selectedCustomer.peppolAddresses?.[0];
    const autoRecipient =
      typeof autoRecipientRaw === "string" ? autoRecipientRaw.trim() : "";
    if (!autoRecipient) {
      return;
    }

    const currentRecipient =
      typeof formData.recipient === "string" ? formData.recipient.trim() : "";

    const shouldAutoUpdate =
      (!currentRecipient && lastAutoRecipientRef.current === null) ||
      currentRecipient === lastAutoRecipientRef.current;

    if (shouldAutoUpdate && currentRecipient !== autoRecipient) {
      lastAutoRecipientRef.current = autoRecipient;
      onFormChange({
        ...formData,
        recipient: autoRecipient,
      });
    }
  }, [selectedCustomer, formData.recipient, onFormChange]);

  useEffect(() => {
    setIsCounterpartyOpen(mode === "developer");
  }, [mode, selectedCustomerId, selectedCompanyId, formData.documentType]);

  const handleDocumentChange = (documentData: any) => {
    onFormChange({
      ...formData,
      document: documentData,
    });
  };

  const handleRecipientChange = (recipient: string) => {
    onFormChange({
      ...formData,
      recipient,
    });
  };

  const handleEmailOptionsChange = (emailOptions: any) => {
    onFormChange({
      ...formData,
      email: emailOptions,
    });
  };

  const handlePdfGenerationToggle = (enabled: boolean) => {
    const auto = getAutoPdfFilename();
    onFormChange({
      ...formData,
      pdfGeneration: enabled
        ? auto
          ? (() => {
              lastAutoPdfFilenameRef.current = auto;
              return { enabled: true, filename: auto };
            })()
          : { enabled: true }
        : undefined,
    });
  };

  const handlePdfFilenameChange = (filename: string) => {
    const nextFilename = filename.trim().length > 0 ? filename : undefined;
    onFormChange({
      ...formData,
      pdfGeneration: {
        enabled: true,
        ...(nextFilename ? { filename: nextFilename } : {}),
      },
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedCompanyId) {
      toast.error(t`Please select a company`);
      return;
    }

    const hasRecipient = !!formData.recipient?.trim();
    const hasEmailRecipients =
      (formData.email?.to?.filter((e) => e).length ?? 0) > 0;
    const billingTypes: DocumentType[] = [
      DocumentType.INVOICE,
      DocumentType.CREDIT_NOTE,
      DocumentType.SELF_BILLING_INVOICE,
      DocumentType.SELF_BILLING_CREDIT_NOTE,
    ];
    const isBillingType = billingTypes.includes(
      formData.documentType as DocumentType
    );

    if (!hasRecipient && !hasEmailRecipients) {
      toast.error(
        t`Please enter a recipient Peppol ID or configure email delivery`
      );
      return;
    }

    if (!hasRecipient && !isBillingType) {
      toast.error(
        t`Email-only delivery is only supported for (self-billing) invoices and credit notes`
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        ...formData,
        recipient: formData.recipient?.trim() || null,
      } as SendDocument;

      const response = await client[":companyId"]["sendDocument"].$post({
        param: { companyId: selectedCompanyId },
        json: payload,
      });

      const json = await response.json();

      if (!json.success) {
        toast.error(stringifyActionFailure(json.errors));
      } else {
        toast.success(
          <div className="flex flex-col gap-1">
            <p className="font-semibold">{t`Document sent successfully!`}</p>
            {json.sentOverPeppol && (
              <p className="text-xs">{t`✓ Sent over Peppol network`}</p>
            )}
            {json.sentOverEmail && (
              <p className="text-xs">
                {t`✓ Sent to ${json.emailRecipients?.join(", ")}`}
              </p>
            )}
          </div>
        );

        // Navigate to transmitted documents page
        navigate("/transmitted-documents");
      }
    } catch (error) {
      console.error("Error sending document:", error);
      toast.error(t`Failed to send document`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <div>
          <Label htmlFor="company">{t`Sending Company *`}</Label>
          <CompanySelector
            value={selectedCompanyId}
            onChange={onCompanyChange}
          />
        </div>

        <Card className="p-4">
          <div className="space-y-4">
            <div>
              <Label htmlFor="customer">{t`Customer`}</Label>
              <Combobox
                value={selectedCustomerId}
                onValueChange={setSelectedCustomerId}
                options={customers.map((c) => ({
                  value: c.id,
                  label: c.vatNumber ? `${c.name} - ${c.vatNumber}` : c.name,
                }))}
                placeholder={t`Select a customer...`}
                searchPlaceholder={t`Search customers...`}
                emptyText={t`No customers found.`}
                disabled={!activeTeam?.id}
              />
            </div>

            <div>
              <Label htmlFor="recipient">{t`Recipient Peppol ID`}</Label>
              <RecipientSelector
                value={formData.recipient || ""}
                onChange={handleRecipientChange}
                optional
              />
            </div>

            {counterpartyKey && (
              <Collapsible
                open={isCounterpartyOpen}
                onOpenChange={setIsCounterpartyOpen}
              >
                <CollapsibleTrigger className="flex w-full items-center justify-between py-2 font-medium transition-colors hover:text-primary">
                  <span>{counterpartyLabel}</span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${isCounterpartyOpen ? "rotate-180" : ""}`}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4">
                  <PartyForm
                    party={counterpartyParty || {}}
                    onChange={handleCounterpartyChange as any}
                    required
                    disabled={false}
                  />
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </Card>

        <EmailOptions
          value={formData.email}
          onChange={handleEmailOptionsChange}
          suggestedEmail={selectedCustomer?.email}
        />

        {type !== "xml" && (
          <Card className="p-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="pdf-generation-enabled">
                    {t`Include generated PDF`}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t`Generates a PDF of the document and embeds it as an attachment.`}
                  </p>
                </div>
                <Switch
                  id="pdf-generation-enabled"
                  checked={formData.pdfGeneration?.enabled === true}
                  onCheckedChange={handlePdfGenerationToggle}
                />
              </div>

              {mode === "developer" && formData.pdfGeneration?.enabled && (
                <div className="space-y-2">
                  <Label htmlFor="pdf-generation-filename">{t`PDF filename`}</Label>
                  <Input
                    id="pdf-generation-filename"
                    value={formData.pdfGeneration.filename ?? ""}
                    onChange={(e) => handlePdfFilenameChange(e.target.value)}
                    placeholder={getAutoPdfFilename() ?? "document.pdf"}
                  />
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      <div className="border-t pt-6">
        {type === "invoice" && (
          <InvoiceForm
            document={formData.document || {}}
            onChange={handleDocumentChange}
            companyId={selectedCompanyId}
            isSelfBilling={
              formData.documentType === DocumentType.SELF_BILLING_INVOICE
            }
            customerParty={customerParty}
            mode={mode}
            groupedCounterpartyKey={counterpartyKey}
          />
        )}
        {type === "creditNote" && (
          <CreditNoteForm
            document={formData.document || {}}
            onChange={handleDocumentChange}
            companyId={selectedCompanyId}
            isSelfBilling={
              formData.documentType === DocumentType.SELF_BILLING_CREDIT_NOTE
            }
            customerParty={customerParty}
            mode={mode}
            groupedCounterpartyKey={counterpartyKey}
          />
        )}
        {type === "xml" && (
          <XmlForm
            document={(formData.document as string) || ""}
            onChange={handleDocumentChange}
            doctypeId={formData.doctypeId}
            onDoctypeIdChange={(id) =>
              onFormChange({ ...formData, doctypeId: id })
            }
            processId={formData.processId}
            onProcessIdChange={(id) =>
              onFormChange({ ...formData, processId: id })
            }
          />
        )}
      </div>

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate("/transmitted-documents")}
        >
          {t`Cancel`}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t`Sending...`}
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              {t`Send Document`}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
