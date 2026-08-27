import type { Integration, IntegrationManifest } from "@peppol/types/integration";
import StringField from "./string-field";
import BooleanField from "./boolean-field";
import NumberField from "./number-field";
import { useTranslation } from "@core/hooks/use-translation";

export default function FieldsConfiguration({
    integration,
    onChange,
}: {
    integration: Integration;
    onChange: (integration: Integration) => void;
}) {
    const { t } = useTranslation();
    const manifest = integration.manifest as IntegrationManifest;
    const fields = manifest.fields || [];
    const currentFields = integration.configuration?.fields || [];

    const handleFieldChange = (fieldId: string, value: string | boolean | number | undefined) => {
        const existingIndex = currentFields.findIndex((f) => f.id === fieldId);
        const newFields = [...currentFields];

        if (value === undefined) {
            if (existingIndex >= 0) {
                newFields.splice(existingIndex, 1);
            }
        } else if (existingIndex >= 0) {
            const existingField = currentFields[existingIndex];
            if (existingField.type === "string" && typeof value === "string") {
                newFields[existingIndex] = { ...existingField, value };
            } else if (existingField.type === "boolean" && typeof value === "boolean") {
                newFields[existingIndex] = { ...existingField, value };
            } else if (existingField.type === "number" && typeof value === "number") {
                newFields[existingIndex] = { ...existingField, value };
            }
        } else {
            const manifestField = fields.find((f) => f.id === fieldId);
            if (!manifestField) return;

            if (manifestField.type === "string" && typeof value === "string") {
                newFields.push({ id: fieldId, type: "string", value });
            } else if (manifestField.type === "boolean" && typeof value === "boolean") {
                newFields.push({ id: fieldId, type: "boolean", value });
            } else if (manifestField.type === "number" && typeof value === "number") {
                newFields.push({ id: fieldId, type: "number", value });
            }
        }

        onChange({
            ...integration,
            configuration: {
                ...integration.configuration || { auth: { type: "bearer" as const, token: "" } },
                auth: integration.configuration?.auth || { type: "bearer" as const, token: "" },
                fields: newFields,
                capabilities: integration.configuration?.capabilities || [],
            },
        });
    };

    const getFieldValue = (fieldId: string, fieldType: "string" | "boolean" | "number"): string | boolean | number | undefined => {
        const field = currentFields.find((f) => f.id === fieldId);
        if (field && field.type === fieldType) {
            return field.value;
        }
        return undefined;
    };

    if (fields.length === 0) {
        return (
            <div className="text-sm text-muted-foreground">
                {t`No configurable fields available for this integration.`}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {fields.map((manifestField) => {
                const value = getFieldValue(manifestField.id, manifestField.type);
                const currentField = currentFields.find((f) => f.id === manifestField.id);

                if (manifestField.type === "string") {
                    const stringField = currentField && currentField.type === "string" 
                        ? currentField 
                        : { id: manifestField.id, type: "string" as const, value: "" };
                    return (
                        <StringField
                            key={manifestField.id}
                            field={stringField}
                            value={(value as string) || ""}
                            onChange={(newValue) => handleFieldChange(manifestField.id, newValue)}
                            required={manifestField.required}
                            title={t(manifestField.title)}
                            description={t(manifestField.description)}
                        />
                    );
                } else if (manifestField.type === "boolean") {
                    const booleanField = currentField && currentField.type === "boolean"
                        ? currentField
                        : { id: manifestField.id, type: "boolean" as const, value: false as boolean };
                    return (
                        <BooleanField
                            key={manifestField.id}
                            field={booleanField}
                            value={value as boolean | undefined}
                            onChange={(newValue) => handleFieldChange(manifestField.id, newValue)}
                            required={manifestField.required}
                            title={t(manifestField.title)}
                            description={t(manifestField.description)}
                        />
                    );
                } else if (manifestField.type === "number") {
                    const numberField = currentField && currentField.type === "number"
                        ? currentField
                        : { id: manifestField.id, type: "number" as const, value: 0 as number };
                    return (
                        <NumberField
                            key={manifestField.id}
                            field={numberField}
                            value={value as number | undefined}
                            onChange={(newValue) => handleFieldChange(manifestField.id, newValue)}
                            required={manifestField.required}
                            title={t(manifestField.title)}
                            description={t(manifestField.description)}
                        />
                    );
                }
                return null;
            })}
        </div>
    );
}
