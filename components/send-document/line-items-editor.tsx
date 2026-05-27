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
                  <Label>Item Name *</Label>
                  <Input
                    value={line.name}
                    onChange={(e) =>
                      updateLine(index, "name", e.target.value)
                    }
                    placeholder={
                      isCreditNote ? "Credit item" : "Product or service"
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
                <Label>Description</Label>
                <Textarea
                  value={line.description || ""}
                  onChange={(e) =>
                    updateLine(index, "description", e.target.value)
                  }
                  placeholder="Optional description"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Quantity *</Label>
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
                  <Label>Unit</Label>
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
                      <SelectItem value="C62">One</SelectItem>
                      <SelectItem value="HUR">Hour</SelectItem>
                      <SelectItem value="DAY">Day</SelectItem>
                      <SelectItem value="MON">Month</SelectItem>
                      <SelectItem value="KGM">Kilogram</SelectItem>
                      <SelectItem value="MTR">Meter</SelectItem>
                      <SelectItem value="LTR">Liter</SelectItem>
                      <SelectItem value="MWH">Megawatt hour (MWh)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Price *</Label>
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
                  <Label>VAT Category</Label>
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
                          {code}: {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>VAT %</Label>
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
                <span className="text-muted-foreground">Line Total:</span>
                <div className="text-right">
                  <div>Net: €{lineTotal.netAmount}</div>
                  <div className="text-xs text-muted-foreground">
                    VAT: €{lineTotal.vatAmount} | Total: €
                    {lineTotal.totalAmount}
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
          Add Line
        </Button>

        {lines.length > 0 && (
          <Card className="p-3">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Net Total:</span>
                <p className="font-medium">€{totals.totalNet}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Total VAT:</span>
                <p className="font-medium">€{totals.totalVat}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Total Gross:</span>
                <p className="font-semibold">€{totals.totalGross}</p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
