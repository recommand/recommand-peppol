import { useState } from "react";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Textarea } from "@core/components/ui/textarea";
import { Label } from "@core/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@core/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import type { DocumentLine } from "@peppol/utils/parsing/invoice/schemas";
import { VAT_CATEGORIES } from "@peppol/utils/parsing/invoice/schemas";
import { Card } from "@core/components/ui/card";
import { useTranslation } from "@core/hooks/use-translation";

interface LineItemsEditorProps {
  lines: DocumentLine[];
  onChange: (lines: DocumentLine[]) => void;
  isCreditNote?: boolean;
}

export function LineItemsEditor({
  lines,
  onChange,
  isCreditNote = false,
}: LineItemsEditorProps) {
  const { t } = useTranslation();
  const [expandedLines, setExpandedLines] = useState<Set<number>>(new Set([0]));

  const addLine = () => {
    const newLine: DocumentLine = {
      name: "",
      quantity: "1",
      unitCode: "C62",
      netPriceAmount: "0",
      vat: {
        category: "S",
        percentage: "21",
      },
    };
    onChange([...lines, newLine]);
    setExpandedLines(new Set([...expandedLines, lines.length]));
  };

  const updateLine = (index: number, field: keyof DocumentLine, value: any) => {
    const updatedLines = [...lines];
    if (field === "vat") {
      updatedLines[index] = { ...updatedLines[index], vat: value };
    } else {
      updatedLines[index] = { ...updatedLines[index], [field]: value };
    }
    onChange(updatedLines);
  };

  const removeLine = (index: number) => {
    onChange(lines.filter((_, i) => i !== index));
    const newExpanded = new Set(expandedLines);
    newExpanded.delete(index);
    setExpandedLines(newExpanded);
  };

  const calculateLineTotal = (line: DocumentLine) => {
    const quantity = parseFloat(line.quantity || "0");
    const price = parseFloat(line.netPriceAmount || "0");
    const vatPercentage = parseFloat(line.vat?.percentage || "0");
    const netAmount = quantity * price;
    const vatAmount = netAmount * (vatPercentage / 100);
    return {
      netAmount: netAmount.toFixed(2),
      vatAmount: vatAmount.toFixed(2),
      totalAmount: (netAmount + vatAmount).toFixed(2),
    };
  };

  const calculateTotals = () => {
    let totalNet = 0;
    let totalVat = 0;

    lines.forEach((line) => {
      const { netAmount, vatAmount } = calculateLineTotal(line);
      totalNet += parseFloat(netAmount);
      totalVat += parseFloat(vatAmount);
    });

    return {
      totalNet: totalNet.toFixed(2),
      totalVat: totalVat.toFixed(2),
      totalGross: (totalNet + totalVat).toFixed(2),
    };
  };

  const totals = calculateTotals();

  return (
    <div className="space-y-4">
      {lines.map((line, index) => {
        const lineTotal = calculateLineTotal(line);

        return (
          <Card key={index} className="p-4">
            <div className="space-y-4">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <Label>{t`Item Name *`}</Label>
                  <Input
                    value={line.name}
                    onChange={(e) =>
                      updateLine(index, "name", e.target.value)
                    }
                    placeholder={
                      isCreditNote ? t`Credit item` : t`Product or service`
                    }
                    required
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost-destructive"
                  size="icon"
                  onClick={() => removeLine(index)}
                  className="mt-6"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div>
                <Label>{t`Description`}</Label>
                <Textarea
                  value={line.description || ""}
                  onChange={(e) =>
                    updateLine(index, "description", e.target.value)
                  }
                  placeholder={t`Optional description`}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>{t`Quantity *`}</Label>
                  <Input
                    type="number"
                    step="any"
                    value={line.quantity}
                    onChange={(e) =>
                      updateLine(index, "quantity", e.target.value)
                    }
                    required
                  />
                </div>
                <div>
                  <Label>{t`Unit`}</Label>
                  <Select
                    value={line.unitCode}
                    onValueChange={(value) =>
                      updateLine(index, "unitCode", value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="C62">{t`One`}</SelectItem>
                      <SelectItem value="HUR">{t`Hour`}</SelectItem>
                      <SelectItem value="DAY">{t`Day`}</SelectItem>
                      <SelectItem value="MON">{t`Month`}</SelectItem>
                      <SelectItem value="KGM">{t`Kilogram`}</SelectItem>
                      <SelectItem value="MTR">{t`Meter`}</SelectItem>
                      <SelectItem value="LTR">{t`Liter`}</SelectItem>
                      <SelectItem value="MWH">{t`Megawatt hour (MWh)`}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t`Price *`}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={line.netPriceAmount}
                    onChange={(e) =>
                      updateLine(index, "netPriceAmount", e.target.value)
                    }
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>{t`VAT Category`}</Label>
                  <Select
                    value={line.vat?.category || "S"}
                    onValueChange={(value) =>
                      updateLine(index, "vat", { ...line.vat, category: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(VAT_CATEGORIES).map(([code, name]) => (
                        <SelectItem key={code} value={code}>
                          {code}: {t(name)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t`VAT %`}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={line.vat?.percentage || "21"}
                    onChange={(e) =>
                      updateLine(index, "vat", {
                        ...line.vat,
                        percentage: e.target.value,
                      })
                    }
                  />
                </div>
              </div>

              <div className="flex justify-between items-center pt-2 border-t text-sm">
                <span className="text-muted-foreground">{t`Line Total:`}</span>
                <div className="text-right">
                  <div>{t`Net: €${lineTotal.netAmount}`}</div>
                  <div className="text-xs text-muted-foreground">
                    {t`VAT: €${lineTotal.vatAmount} | Total: €${lineTotal.totalAmount}`}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        );
      })}

      <div className="flex justify-between items-center">
        <Button type="button" variant="outline" onClick={addLine}>
          <Plus className="mr-2 h-4 w-4" />
          {t`Add Line`}
        </Button>

        {lines.length > 0 && (
          <Card className="p-3">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">{t`Net Total:`}</span>
                <p className="font-medium">€{totals.totalNet}</p>
              </div>
              <div>
                <span className="text-muted-foreground">{t`Total VAT:`}</span>
                <p className="font-medium">€{totals.totalVat}</p>
              </div>
              <div>
                <span className="text-muted-foreground">{t`Total Gross:`}</span>
                <p className="font-semibold">€{totals.totalGross}</p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
