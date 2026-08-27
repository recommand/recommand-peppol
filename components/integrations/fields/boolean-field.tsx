import { Label } from "@core/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@core/components/ui/select";
import type { IntegrationConfigurationField } from "@peppol/types/integration";
import { useTranslation } from "@core/hooks/use-translation";

export default function BooleanField({
    field,
    value,
    onChange,
    required,
    title,
    description,
}: {
    field: IntegrationConfigurationField & { type: "boolean" };
    value: boolean | undefined;
    onChange: (value: boolean | undefined) => void;
    required: boolean;
    title: string;
    description: string;
}) {
    const { t } = useTranslation();
    const getSelectValue = (): string => {
        if (value === undefined) return "not-specified";
        return value ? "true" : "false";
    };

    const handleValueChange = (newValue: string) => {
        if (newValue === "not-specified") {
            onChange(undefined);
        } else if (newValue === "true") {
            onChange(true);
        } else {
            onChange(false);
        }
    };

    return (
        <div className="space-y-2">
            <Label htmlFor={field.id}>
                {title}
                {required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Select value={getSelectValue()} onValueChange={handleValueChange}>
                <SelectTrigger id={field.id} className="w-full">
                    <SelectValue placeholder={t`Not specified`} />
                </SelectTrigger>
                <SelectContent>
                    {!required && <SelectItem value="not-specified">{t`Not specified`}</SelectItem>}
                    <SelectItem value="true">{t`True`}</SelectItem>
                    <SelectItem value="false">{t`False`}</SelectItem>
                </SelectContent>
            </Select>
            {description && (
                <p className="text-xs text-pretty text-muted-foreground">{description}</p>
            )}
        </div>
    );
}
