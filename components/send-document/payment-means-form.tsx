import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Button } from "@core/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import type { PaymentMeans } from "@peppol/utils/parsing/invoice/schemas";
import { Card } from "@core/components/ui/card";
import { useTranslation } from "@core/hooks/use-translation";

interface PaymentMeansFormProps {
  paymentMeans: PaymentMeans[];
  onChange: (paymentMeans: PaymentMeans[]) => void;
}

export function PaymentMeansForm({ paymentMeans, onChange }: PaymentMeansFormProps) {
  const { t } = useTranslation();
  const addPaymentMeans = () => {
    onChange([
      ...paymentMeans,
      {
        paymentMethod: "credit_transfer",
        reference: "",
        iban: "",
      },
    ]);
  };

  const updatePaymentMeans = (index: number, field: keyof PaymentMeans, value: string) => {
    const updated = [...paymentMeans];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const removePaymentMeans = (index: number) => {
    onChange(paymentMeans.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      {paymentMeans.map((payment, index) => (
        <Card key={index} className="p-4">
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 space-y-4">
                <div>
                  <Label htmlFor={`iban-${index}`}>{t`IBAN *`}</Label>
                  <Input
                    id={`iban-${index}`}
                    value={payment.iban}
                    onChange={(e) => updatePaymentMeans(index, "iban", e.target.value)}
                    placeholder="BE71 0961 2345 6769"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor={`reference-${index}`}>{t`Payment Reference`}</Label>
                  <Input
                    id={`reference-${index}`}
                    value={payment.reference}
                    onChange={(e) => updatePaymentMeans(index, "reference", e.target.value)}
                    placeholder={t`Invoice number or reference`}
                  />
                </div>
              </div>
              <Button
                type="button"
                variant="ghost-destructive"
                size="icon"
                onClick={() => removePaymentMeans(index)}
                className="ml-2 mt-6"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      ))}

      <Button type="button" variant="outline" onClick={addPaymentMeans}>
        <Plus className="mr-2 h-4 w-4" />
        {t`Add Payment Method`}
      </Button>
    </div>
  );
}
