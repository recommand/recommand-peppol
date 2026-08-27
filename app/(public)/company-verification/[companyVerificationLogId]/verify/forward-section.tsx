import { rc } from "@recommand/lib/client";
import type { Companies } from "@peppol/api/companies";
import { useState } from "react";
import { stringifyActionFailure } from "@recommand/lib/utils";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { StatusMessage } from "@recommand/components/status-feedback";
import { Loader2, AlertCircle, Mail, CheckCircle2, ChevronDown, Copy, Check } from "lucide-react";
import { useTranslation } from "@core/hooks/use-translation";

const client = rc<Companies>("v1");
const peppolClient = rc<Companies>("peppol");

type ForwardSectionProps =
    | { companyVerificationLogId: string; teamId?: never; companyId?: never; onAction?: () => void }
    | { companyVerificationLogId: null; teamId: string; companyId: string; onAction?: () => void };

export function ForwardSection({ companyVerificationLogId, teamId, companyId, onAction }: ForwardSectionProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState("");
    const [requesterName, setRequesterName] = useState("");
    const [requesterEmail, setRequesterEmail] = useState("");
    const [isForwarding, setIsForwarding] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const handleForward = async () => {
        if (!email || !requesterName || !requesterEmail) return;

        try {
            setIsForwarding(true);
            setError(null);

            let logId = companyVerificationLogId;

            if (logId === null) {
                const res = await peppolClient[":teamId"]["companies"][":companyId"]["verify"].$post({
                    param: { teamId: teamId!, companyId: companyId! },
                });
                const json = await res.json();
                if (!json.success) {
                    setError(stringifyActionFailure(json.errors));
                    return;
                }
                logId = json.verificationLogId;
            }

            const response = await client["companies"]["verification"][":companyVerificationLogId"]["forward"].$post({
                param: { companyVerificationLogId: logId },
                json: { email, requesterName, requesterEmail },
            });
            const json = await response.json();
            if (!json.success) {
                setError(stringifyActionFailure(json.errors));
                return;
            }
            setSuccess(true);
            setEmail("");
            onAction?.();
        } catch {
            setError(t`An unexpected error occurred. Please try again.`);
        } finally {
            setIsForwarding(false);
        }
    };

    const handleCopyUrl = async () => {
        try {
            setIsCopying(true);

            let logId = companyVerificationLogId;

            if (logId === null) {
                const res = await peppolClient[":teamId"]["companies"][":companyId"]["verify"].$post({
                    param: { teamId: teamId!, companyId: companyId! },
                });
                const json = await res.json();
                if (!json.success) {
                    setError(stringifyActionFailure(json.errors));
                    return;
                }
                logId = json.verificationLogId;
            }

            const url = `${window.location.origin}/company-verification/${logId}/verify`;
            await navigator.clipboard.writeText(url);
            setCopied(true);
            onAction?.();
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setError(t`Failed to copy URL. Please try again.`);
        } finally {
            setIsCopying(false);
        }
    };

    return (
        <div className="border-t pt-6 space-y-4">
            <div className="flex flex-col items-center gap-2">
                <p className="text-sm text-muted-foreground">{t`Not the right person to complete this?`}</p>
                <div className="flex gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setOpen((v) => !v)}
                    >
                        <Mail className="h-4 w-4" />
                        {t`Forward to someone else`}
                        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleCopyUrl}
                        disabled={isCopying}
                    >
                        {isCopying ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : copied ? (
                            <Check className="h-4 w-4" />
                        ) : (
                            <Copy className="h-4 w-4" />
                        )}
                        {copied ? t`Copied!` : t`Copy verification URL`}
                    </Button>
                </div>
            </div>
            {open && (success ? (
                <StatusMessage
                    tone="success"
                    icon={CheckCircle2}
                    title={t`Verification link sent`}
                    description={t`The request was forwarded successfully. You can close this page.`}
                />
            ) : (
                <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="requesterName">{t`Your name`}</Label>
                            <Input
                                id="requesterName"
                                placeholder="Jane Smith"
                                value={requesterName}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRequesterName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="requesterEmail">{t`Your email`}</Label>
                            <Input
                                id="requesterEmail"
                                type="email"
                                placeholder="you@company.com"
                                value={requesterEmail}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRequesterEmail(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="flex items-end gap-2">
                        <div className="flex-1 space-y-1.5">
                            <Label htmlFor="forwardEmail">{t`Forward to`}</Label>
                            <Input
                                id="forwardEmail"
                                type="email"
                                placeholder="colleague@company.com"
                                value={email}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                            />
                        </div>
                        <Button
                            variant="outline"
                            onClick={handleForward}
                            disabled={isForwarding || !email || !requesterName || !requesterEmail}
                        >
                            {isForwarding ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <>
                                    <Mail className="h-4 w-4" />
                                    {t`Forward`}
                                </>
                            )}
                        </Button>
                    </div>
                    {error && (
                        <StatusMessage tone="error" icon={AlertCircle} description={error} />
                    )}
                </div>
            ))}
        </div>
    );
}
