import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Button } from "@core/components/ui/button";
import type { Label as LabelType } from "../types/label";
import { AsyncButton } from "@core/components/async-button";
import { FOLDER, WARNING, DATA, PROGRESS, CONST } from "@core/lib/config/colors";
import { useTranslation } from "@core/hooks/use-translation";

const COLOR_PRESETS = [
  { name: "Green", value: FOLDER },
  { name: "Orange", value: WARNING },
  { name: "Yellow", value: DATA },
  { name: "Blue", value: PROGRESS },
  { name: "Purple", value: CONST },
] as const;

type LabelFormProps = {
    label: Partial<LabelType>;
    onChange: (label: Partial<LabelType>) => void;
    onSubmit: () => Promise<void>;
    onCancel: () => void;
    isEditing?: boolean;
};

export function LabelForm({ label, onChange, onSubmit, onCancel, isEditing = false }: LabelFormProps) {
    const { t } = useTranslation();
    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="name">{t`Label Name`}</Label>
                <Input
                    id="name"
                    value={label.name || ""}
                    onChange={(e) => onChange({ ...label, name: e.target.value })}
                    required
                />
            </div>
            <div className="space-y-2">
                <Label htmlFor="colorHex">{t`Color`}</Label>
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <Input
                            id="colorHex"
                            type="color"
                            value={label.colorHex || FOLDER}
                            onChange={(e) => onChange({ ...label, colorHex: e.target.value })}
                            className="w-20 h-10"
                        />
                        <Input
                            type="text"
                            value={label.colorHex || FOLDER}
                            onChange={(e) => onChange({ ...label, colorHex: e.target.value })}
                            placeholder="#4ECB8E"
                            pattern="^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$"
                            className="flex-1"
                        />
                    </div>
                    <div className="flex flex-wrap gap-1.5 justify-end">
                        {COLOR_PRESETS.map((preset) => {
                            const presetName = preset.name === "Green" ? t`Green` : preset.name === "Orange" ? t`Orange` : preset.name === "Yellow" ? t`Yellow` : preset.name === "Blue" ? t`Blue` : t`Purple`;
                            return <button
                                key={preset.value}
                                type="button"
                                onClick={() => onChange({ ...label, colorHex: preset.value })}
                                className={`w-5 h-5 rounded border-2 transition-all ${
                                    label.colorHex === preset.value
                                        ? "border-foreground scale-110"
                                        : "border-border hover:border-foreground/50"
                                }`}
                                style={{ backgroundColor: preset.value }}
                                title={presetName}
                                aria-label={t`Select ${presetName} color`}
                            />;
                        })}
                    </div>
                </div>
            </div>
            <div className="space-y-2">
                <Label htmlFor="externalId">{t`External ID (Optional)`}</Label>
                <Input
                    id="externalId"
                    value={label.externalId || ""}
                    onChange={(e) => onChange({ ...label, externalId: e.target.value || null })}
                />
            </div>
            <div className="flex justify-end gap-2">
                <Button
                    type="button"
                    variant="outline"
                    onClick={onCancel}
                >
                    {t`Cancel`}
                </Button>
                <AsyncButton type="submit" onClick={onSubmit}>
                    {isEditing ? t`Save Changes` : t`Create Label`}
                </AsyncButton>
            </div>
        </div>
    );
}
