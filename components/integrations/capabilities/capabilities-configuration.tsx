import { Checkbox } from "@core/components/ui/checkbox";
import { Label } from "@core/components/ui/label";
import type { Integration, IntegrationManifest, IntegrationEvent } from "@peppol/types/integration";
import { getConfigurableIntegrationEventDescription } from "@peppol/utils/integrations";
import { useTranslation } from "@core/hooks/use-translation";

export default function CapabilitiesConfiguration({
    integration,
    onChange,
}: {
    integration: Integration;
    onChange: (integration: Integration) => void;
}) {
    const { t } = useTranslation();
    const manifest = integration.manifest as IntegrationManifest;
    const capabilities = manifest.capabilities || [];
    const currentCapabilities = integration.configuration?.capabilities || [];

    const handleCapabilityToggle = (event: IntegrationEvent, enabled: boolean) => {
        const manifestCapability = capabilities.find((c) => c.event === event);
        if (!manifestCapability) return;

        if (manifestCapability.required && !enabled) {
            return;
        }

        const existingIndex = currentCapabilities.findIndex((c) => c.event === event);
        const newCapabilities = [...currentCapabilities];

        if (existingIndex >= 0) {
            newCapabilities[existingIndex] = { event, enabled };
        } else {
            newCapabilities.push({ event, enabled });
        }

        onChange({
            ...integration,
            configuration: {
                ...integration.configuration || { auth: { type: "bearer" as const, token: "" } },
                auth: integration.configuration?.auth || { type: "bearer" as const, token: "" },
                fields: integration.configuration?.fields || [],
                capabilities: newCapabilities,
            },
        });
    };

    const isCapabilityEnabled = (event: IntegrationEvent): boolean => {
        const capability = currentCapabilities.find((c) => c.event === event);
        return capability?.enabled ?? false;
    };

    if (capabilities.length === 0) {
        return (
            <div className="text-sm text-muted-foreground">
                {t`No configurable capabilities available for this integration.`}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {capabilities.map((capability) => {
                const eventDescription = getConfigurableIntegrationEventDescription(capability.event);
                const isEnabled = isCapabilityEnabled(capability.event);
                const isRequired = capability.required;

                return (
                    <div key={capability.event} className="flex items-start space-x-3 space-y-0">
                        <Checkbox
                            id={capability.event}
                            checked={isEnabled || isRequired && !isEnabled}
                            disabled={isRequired}
                            onCheckedChange={(checked) =>
                                handleCapabilityToggle(capability.event, checked === true)
                            }
                            className="mt-1"
                        />
                        <div className="space-y-1 flex-1">
                            <Label
                                htmlFor={capability.event}
                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                            >
                                {eventDescription?.title ? t(eventDescription.title) : capability.event}
                                {isRequired && (
                                    <span className="ml-2 text-xs text-muted-foreground">{t`(Required)`}</span>
                                )}
                            </Label>
                            <p className="text-xs text-pretty text-muted-foreground">
                                {t(eventDescription?.description || capability.description)}
                            </p>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
