import { Link, Text } from "@react-email/components";
import { EmailLayout, EmailHeading, InfoSection } from "@core/emails/components/shared";
import { fallbackT, type TranslationFunction } from "@core/lib/translations";

interface FailedPaymentEmailProps {
  companyName: string;
  invoiceReference: number;
  totalAmountIncl: number;
  billingDate: string;
  t?: TranslationFunction;
}

export const FailedPaymentEmail = ({
  companyName,
  invoiceReference,
  totalAmountIncl,
  billingDate,
  t = fallbackT,
}: FailedPaymentEmailProps) => (
  <EmailLayout preview={t`Payment failed for invoice ${invoiceReference}`} t={t}>
    <EmailHeading>{t`Payment failed`}</EmailHeading>
    <Text className="mb-4">{t`Dear ${companyName},`}</Text>
    <Text className="mb-4">
      {t`We attempted to process the payment for your recent invoice, but this was unsuccessful. Your payment method may need to be updated.`}
    </Text>
    <InfoSection>
      <Text className="my-1 text-sm">
        <strong>{t`Invoice reference`}:</strong> {invoiceReference}
      </Text>
      <Text className="my-1 text-sm">
        <strong>{t`Billing date`}:</strong> {billingDate}
      </Text>
      <Text className="my-1 text-sm">
        <strong>{t`Amount`}:</strong> € {totalAmountIncl.toFixed(2)}
      </Text>
    </InfoSection>
    <Text className="mb-4">
      {t`Please update your payment method in your account settings, or contact us at`}{" "}
      <Link href="mailto:billing@recommand.eu">billing@recommand.eu</Link>{" "}
      {t`to resolve this issue.`}{" "}
      <Link href="https://app.recommand.eu/billing/subscription">
        {t`Open your billing settings`}
      </Link>
      .
    </Text>
    <Text className="mb-4">{t`Thank you for your understanding.`}</Text>
  </EmailLayout>
);

FailedPaymentEmail.PreviewProps = {
  companyName: "Acme Corporation",
  invoiceReference: 5001,
  totalAmountIncl: 1210.0,
  billingDate: "2024-01-31",
} as FailedPaymentEmailProps;

export default FailedPaymentEmail;
