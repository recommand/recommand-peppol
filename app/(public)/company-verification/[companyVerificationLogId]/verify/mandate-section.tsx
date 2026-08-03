import { rc } from "@recommand/lib/client";
import type { Companies } from "@peppol/api/companies";
import { useState } from "react";
import { Button } from "@core/components/ui/button";
import { Checkbox } from "@core/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@core/components/ui/card";
import { StatusMessage } from "@recommand/components/status-feedback";
import { stringifyActionFailure } from "@recommand/lib/utils";
import { AlertCircle, ArrowLeft, Download, FileText, Loader2, PenLine, ShieldCheck } from "lucide-react";
import { useTranslation } from "@core/hooks/use-translation";

const client = rc<Companies>("v1");

type MandateSectionProps = {
    companyVerificationLogId: string;
    companyName: string;
    firstName: string;
    lastName: string;
    isSigning: boolean;
    signError: string | null;
    onBack: () => void;
    onSign: () => void;
};

export function MandateSection({
    companyVerificationLogId,
    companyName,
    firstName,
    lastName,
    isSigning,
    signError,
    onBack,
    onSign,
}: MandateSectionProps) {
    const { t, language } = useTranslation();
    const [downloadError, setDownloadError] = useState<string | null>(null);
    const [hasAgreed, setHasAgreed] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);

    const fullName = `${firstName} ${lastName}`.trim();
    const signatureDate = new Date().toLocaleDateString(language, {
        year: "numeric",
        month: "long",
        day: "numeric",
    });

    const handleDownload = async () => {
        try {
            setIsDownloading(true);
            setDownloadError(null);
            const response = await client["companies"]["verification"][":companyVerificationLogId"]["mandate-draft"].$post({
                param: { companyVerificationLogId },
                json: { firstName, lastName },
            });
            if (!response.ok) {
                const json = (await response.json().catch(() => null)) as { errors?: unknown } | null;
                setDownloadError(
                    json?.errors
                        ? stringifyActionFailure(json.errors as Parameters<typeof stringifyActionFailure>[0])
                        : t`We could not prepare your mandate. Please try again.`,
                );
                return;
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `mandate-${companyVerificationLogId}.pdf`;
            link.click();
            URL.revokeObjectURL(url);
        } catch {
            setDownloadError(t`We could not prepare your mandate. Please try again.`);
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t`Mandate for electronic invoicing`}</CardTitle>
                    <CardDescription>
                        {t`Read the mandate you are about to sign on behalf of ${companyName}. It authorises us to send, receive and register electronic invoices for the company.`}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4">
                        <FileText className="h-8 w-8 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{t`Mandate for electronic invoicing`}</p>
                            <p className="text-xs text-muted-foreground">
                                {t`PDF, drawn up for ${fullName}`}
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            onClick={() => void handleDownload()}
                            disabled={isDownloading}
                        >
                            {isDownloading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Download className="h-4 w-4" />
                            )}
                            {t`Download`}
                        </Button>
                    </div>

                    {downloadError && (
                        <StatusMessage tone="error" icon={AlertCircle} description={downloadError} />
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <PenLine className="h-4 w-4 text-primary" />
                        {t`Your signature`}
                    </CardTitle>
                    <CardDescription>
                        {t`You sign this mandate with the identity check that follows.`}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="rounded-lg border border-dashed bg-muted/30 px-4 pt-5 pb-3">
                        <p className="font-serif italic text-2xl text-foreground leading-none truncate">
                            {fullName}
                        </p>
                        <div className="mt-2 border-t border-foreground/30 pt-2 flex items-baseline justify-between gap-3">
                            <span className="text-xs text-muted-foreground">
                                {t`Signed by ${fullName}, for ${companyName}`}
                            </span>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">{signatureDate}</span>
                        </div>
                    </div>

                    <label className="flex items-start gap-3 cursor-pointer">
                        <Checkbox
                            checked={hasAgreed}
                            onCheckedChange={(checked) => setHasAgreed(checked === true)}
                            className="mt-0.5"
                        />
                        <span className="text-sm leading-snug text-muted-foreground">
                            {t`I, ${fullName}, have read the mandate and sign it electronically on behalf of ${companyName}.`}
                        </span>
                    </label>
                </CardContent>
            </Card>

            {signError && <StatusMessage tone="error" icon={AlertCircle} description={signError} />}

            <div className="space-y-3">
                <Button
                    onClick={onSign}
                    disabled={!hasAgreed || isSigning}
                    className="w-full"
                    size="lg"
                >
                    {isSigning ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t`Preparing signature...`}
                        </>
                    ) : (
                        <>
                            <ShieldCheck className="h-4 w-4" />
                            {t`Sign with identity verification`}
                        </>
                    )}
                </Button>

                <Button variant="ghost" className="w-full" onClick={onBack} disabled={isSigning}>
                    <ArrowLeft className="h-4 w-4" />
                    {t`Back to your details`}
                </Button>
            </div>

            <p className="text-xs text-center text-muted-foreground">
                {t`You will be redirected to our verification partner. Your verified identity is the proof of signature that is recorded on the mandate.`}
            </p>
        </>
    );
}
