import { useState } from "react";
import { Button } from "@core/components/ui/button";
import { Send, Download, ArrowLeftRight } from "lucide-react";
import { useTranslation } from "@core/hooks/use-translation";

type UsageOption = "send" | "receive" | "both";

type Step3Props = {
    isSmpRecipient: boolean;
    onNext: (isSmpRecipient: boolean) => void;
    onBack: () => void;
};

export function Step3Usage({ isSmpRecipient, onNext, onBack }: Step3Props) {
    const { t } = useTranslation();
    const defaultOption: UsageOption = isSmpRecipient ? "both" : "send";
    const [selected, setSelected] = useState<UsageOption>(defaultOption);

    const options: { value: UsageOption; label: string; description: string; icon: React.ElementType }[] = [
        {
            value: "send",
            label: t`Send documents only`,
            description: t`Use Recommand to send Peppol documents to your customers.`,
            icon: Send,
        },
        {
            value: "receive",
            label: t`Receive documents only`,
            description: t`Register your company in the Peppol network so suppliers can send you documents.`,
            icon: Download,
        },
        {
            value: "both",
            label: t`Send and receive documents`,
            description: t`Full Peppol participation: send documents and receive them from your network.`,
            icon: ArrowLeftRight,
        },
    ];

    const handleNext = () => {
        onNext(selected !== "send");
    };

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                {t`What do you want to use Recommand for with this company?`}
            </p>
            <div className="space-y-3">
                {options.map(({ value, label, description, icon: Icon }) => (
                    <button
                        key={value}
                        type="button"
                        onClick={() => setSelected(value)}
                        className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                            selected === value
                                ? "border-primary bg-primary/5"
                                : "border-border hover:border-primary/40"
                        }`}
                    >
                        <div className="flex items-start gap-3">
                            <div className={`mt-0.5 rounded-full p-1.5 ${selected === value ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                                <Icon className="h-4 w-4" />
                            </div>
                            <div>
                                <div className="font-medium text-sm">{label}</div>
                                <div className="text-xs text-muted-foreground mt-0.5 text-balance">{description}</div>
                            </div>
                        </div>
                    </button>
                ))}
            </div>
            <div className="flex justify-between gap-2 pt-2">
                <Button type="button" variant="outline" onClick={onBack}>
                    {t`Back`}
                </Button>
                <Button type="button" onClick={handleNext}>
                    {t`Create Company`}
                </Button>
            </div>
        </div>
    );
}
