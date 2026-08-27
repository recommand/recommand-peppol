import { useState, useEffect } from "react";
import { Button } from "@core/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@core/components/ui/dialog";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@core/components/ui/radio-group";
import { Checkbox } from "@core/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { rc } from "@recommand/lib/client";
import type { TransmittedDocuments } from "@peppol/api/documents";
import { toast } from "@core/components/ui/sonner";
import { stringifyActionFailure } from "@recommand/lib/utils";
import { useActiveTeam } from "@core/hooks/user";
import { useTranslation } from "@core/hooks/use-translation";

const client = rc<TransmittedDocuments>("peppol");

interface ExportDocumentsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function ExportDocumentsDialog({
    open,
    onOpenChange,
}: ExportDocumentsDialogProps) {
    const { t } = useTranslation();
    const activeTeam = useActiveTeam();
    const [isExporting, setIsExporting] = useState(false);
    const [startDateTime, setStartDateTime] = useState("");
    const [endDateTime, setEndDateTime] = useState("");
    const [outputType, setOutputType] = useState<"flat" | "nested">("flat");
    const [includeIncoming, setIncludeIncoming] = useState(true);
    const [includeOutgoing, setIncludeOutgoing] = useState(true);
    const [errors, setErrors] = useState<{
        startDateTime?: string;
        endDateTime?: string;
        general?: string;
    }>({});

    const formatDateTimeLocal = (date: Date): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    const getDefaultDateRange = () => {
        const now = new Date();
        const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);

        return {
            start: formatDateTimeLocal(startOfLastMonth),
            end: formatDateTimeLocal(startOfCurrentMonth),
        };
    };

    useEffect(() => {
        if (open) {
            const defaults = getDefaultDateRange();
            setStartDateTime(defaults.start);
            setEndDateTime(defaults.end);
            setIncludeIncoming(true);
            setIncludeOutgoing(true);
            setErrors({});
        }
    }, [open]);

    const validateInputs = (): boolean => {
        const newErrors: typeof errors = {};

        if (!startDateTime) {
            newErrors.startDateTime = t`Start datetime is required`;
        }

        if (!endDateTime) {
            newErrors.endDateTime = t`End datetime is required`;
        }

        if (!includeIncoming && !includeOutgoing) {
            newErrors.general = t`At least one direction (incoming or outgoing) must be selected`;
        }

        if (startDateTime && endDateTime) {
            const start = new Date(startDateTime);
            const end = new Date(endDateTime);

            if (end <= start) {
                newErrors.endDateTime = t`End datetime must be after start datetime`;
            } else {
                const maxRange = 31 * 24 * 60 * 60 * 1000;
                const range = end.getTime() - start.getTime();
                if (range > maxRange) {
                    newErrors.endDateTime = t`Date range must not exceed 1 month (31 days)`;
                }
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleExport = async () => {
        if (!validateInputs() || !activeTeam?.id) {
            return;
        }

        setIsExporting(true);
        setErrors({});

        try {
            const start = new Date(startDateTime);
            const end = new Date(endDateTime);

            let direction: "incoming" | "outgoing" | undefined;
            if (includeIncoming && !includeOutgoing) {
                direction = "incoming";
            } else if (includeOutgoing && !includeIncoming) {
                direction = "outgoing";
            }

            const response = await client[":teamId"]["documents"]["export"].$post({
                param: { teamId: activeTeam.id },
                json: {
                    from: start,
                    to: end,
                    outputType,
                    generatePdf: "never",
                    ...(direction && { direction }),
                },
            });

            if (!response.ok) {
                const json = await response.json() as { errors?: { [key: string]: string[] | undefined }; success?: boolean };
                if (json.errors) {
                    setErrors({ general: stringifyActionFailure(json.errors) });
                    toast.error(stringifyActionFailure(json.errors));
                } else {
                    throw new Error("Failed to export documents");
                }
                return;
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;

            link.download = response.headers.get("Content-Disposition")?.split("filename=")[1].replaceAll('"', "") || "documents.zip";
            console.log("DOWNLOAD LINK", link.download);

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            toast.success(t`Documents exported successfully`);
            onOpenChange(false);

            setStartDateTime("");
            setEndDateTime("");
            setOutputType("flat");
            setIncludeIncoming(true);
            setIncludeOutgoing(true);
        } catch (error) {
            console.error("Failed to export documents:", error);
            setErrors({ general: t`Failed to export documents. Please try again.` });
            toast.error(t`Failed to export documents`);
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>{t`Export Documents`}</DialogTitle>
                    <DialogDescription>
                        {t`Export all sent/received documents within a date range (max 1 month) as a ZIP archive.`}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="startDateTime">{t`Start datetime (inclusive) *`}</Label>
                            <div className="flex-1" />
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    const defaults = getDefaultDateRange();
                                    setStartDateTime(defaults.start);
                                    setEndDateTime(defaults.end);
                                }}
                                className="h-7 text-xs"
                            >
                                {t`Last month`}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    const now = new Date();
                                    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
                                    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0);
                                    setStartDateTime(formatDateTimeLocal(startOfThisMonth));
                                    setEndDateTime(formatDateTimeLocal(startOfNextMonth));
                                }}
                                className="h-7 text-xs"
                            >
                                {t`This month`}
                            </Button>
                        </div>
                        <Input
                            id="startDateTime"
                            type="datetime-local"
                            value={startDateTime}
                            onChange={(e) => setStartDateTime(e.target.value)}
                            disabled={isExporting}
                            aria-invalid={!!errors.startDateTime}
                        />
                        {errors.startDateTime && (
                            <p className="text-sm text-destructive">{errors.startDateTime}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="endDateTime">{t`End datetime (exclusive) *`}</Label>
                        <Input
                            id="endDateTime"
                            type="datetime-local"
                            value={endDateTime}
                            onChange={(e) => setEndDateTime(e.target.value)}
                            disabled={isExporting}
                            aria-invalid={!!errors.endDateTime}
                        />
                        {errors.endDateTime && (
                            <p className="text-sm text-destructive">{errors.endDateTime}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label>{t`Document direction`}</Label>
                        <div className="space-y-2">
                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id="includeIncoming"
                                    checked={includeIncoming}
                                    onCheckedChange={(checked) => setIncludeIncoming(checked === true)}
                                    disabled={isExporting}
                                />
                                <Label htmlFor="includeIncoming" className="font-normal cursor-pointer">
                                    {t`Include incoming documents`}
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id="includeOutgoing"
                                    checked={includeOutgoing}
                                    onCheckedChange={(checked) => setIncludeOutgoing(checked === true)}
                                    disabled={isExporting}
                                />
                                <Label htmlFor="includeOutgoing" className="font-normal cursor-pointer">
                                    {t`Include outgoing documents`}
                                </Label>
                            </div>
                        </div>
                        {!includeIncoming && !includeOutgoing && (
                            <p className="text-sm text-destructive">{t`At least one direction must be selected`}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label>{t`Output type *`}</Label>
                        <RadioGroup
                            value={outputType}
                            onValueChange={(value) => setOutputType(value as "flat" | "nested")}
                            disabled={isExporting}
                        >
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="flat" id="flat" />
                                <Label htmlFor="flat" className="font-normal cursor-pointer">
                                    {t`Flat UBLs (all XMLs in root)`}
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="nested" id="nested" />
                                <Label htmlFor="nested" className="font-normal cursor-pointer">
                                    {t`Nested structure (document packages)`}
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>

                    {errors.general && (
                        <p className="text-sm text-destructive">{errors.general}</p>
                    )}
                </div>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isExporting}
                    >
                        {t`Cancel`}
                    </Button>
                    <Button onClick={handleExport} disabled={isExporting}>
                        {isExporting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                {t`Exporting...`}
                            </>
                        ) : (
                            t`Export`
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
