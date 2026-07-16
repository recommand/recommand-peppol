import { rc } from "@recommand/lib/client";
import type { Companies } from "@peppol/api/companies";
import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { stringifyActionFailure } from "@recommand/lib/utils";
import { useUser } from "@core/hooks/user";
import { Button } from "@core/components/ui/button";
import { Card, CardContent } from "@core/components/ui/card";
import { StatusHero, StatusMessage } from "@recommand/components/status-feedback";
import { Loader2, AlertCircle, ShieldCheck, XCircle, RefreshCw, Clock } from "lucide-react";

const client = rc<Companies>("v1");

const FINAL_STATUSES = ["verified", "rejected", "error"] as const;
const POLLING_STATUSES = ["idVerificationRequested", "inReview"] as const;
const POLL_INTERVAL = 5000;

type VerificationStatus = "opened" | "idVerificationRequested" | "inReview" | "verified" | "rejected" | "error";

type StatusData = {
    status: VerificationStatus;
    errorMessage: string | null;
    companyName: string;
    companyId: string;
};

function DashboardLink() {
    const user = useUser();
    if (!user) return null;
    return (
        <Button variant="outline" className="w-full" asChild>
            <Link to="/companies">Go to Companies</Link>
        </Button>
    );
}

export default function Page() {
    const { companyVerificationLogId } = useParams<{ companyVerificationLogId: string }>();
    const navigate = useNavigate();

    const [statusData, setStatusData] = useState<StatusData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isRestarting, setIsRestarting] = useState(false);
    const [restartError, setRestartError] = useState<string | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchStatus = useCallback(async () => {
        if (!companyVerificationLogId) return;

        try {
            const response = await client["companies"]["verification"][":companyVerificationLogId"]["status"].$get({
                param: { companyVerificationLogId },
            });
            const json = await response.json();
            if (!json.success) {
                setLoadError(stringifyActionFailure(json.errors));
                setIsLoading(false);
                return;
            }

            const data = json as unknown as {
                success: true;
                status: VerificationStatus;
                errorMessage: string | null;
                companyName: string;
                companyId: string;
            };

            const status = data.status;

            if (!(FINAL_STATUSES as readonly string[]).includes(status) && !(POLLING_STATUSES as readonly string[]).includes(status)) {
                navigate(`/company-verification/${companyVerificationLogId}/verify`, { replace: true });
                return;
            }

            setStatusData({ status, errorMessage: data.errorMessage, companyName: data.companyName, companyId: data.companyId });
            setIsLoading(false);

            if ((FINAL_STATUSES as readonly string[]).includes(status) && intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        } catch {
            setLoadError("Failed to load verification status. Please try again.");
            setIsLoading(false);
        }
    }, [companyVerificationLogId, navigate]);

    const handleRestart = useCallback(async () => {
        if (!companyVerificationLogId) return;
        try {
            setIsRestarting(true);
            setRestartError(null);
            const response = await client["companies"]["verification"][":companyVerificationLogId"]["restart-id-verification"].$post({
                param: { companyVerificationLogId },
            });
            const json = await response.json();
            if (!json.success) {
                setRestartError(stringifyActionFailure(json.errors));
                return;
            }
            if ("verificationUrl" in json) {
                window.location.href = json.verificationUrl as string;
            }
        } catch {
            setRestartError("An unexpected error occurred. Please try again.");
        } finally {
            setIsRestarting(false);
        }
    }, [companyVerificationLogId]);

    useEffect(() => {
        if (!companyVerificationLogId) return;

        fetchStatus();

        intervalRef.current = setInterval(fetchStatus, POLL_INTERVAL);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [companyVerificationLogId, fetchStatus]);

    if (isLoading) {
        return (
            <div className="min-h-svh flex items-center justify-center bg-muted/30">
                <div className="text-center space-y-4">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading verification status...</p>
                </div>
            </div>
        );
    }

    if (loadError || !statusData) {
        return (
            <div className="min-h-svh flex items-center justify-center bg-muted/30 px-4">
                <div className="w-full max-w-md">
                    <StatusHero
                        tone="error"
                        icon={AlertCircle}
                        title="Status unavailable"
                        description={loadError || "Verification status could not be loaded."}
                    />
                </div>
            </div>
        );
    }

    if (statusData.status === "idVerificationRequested") {
        return (
            <div className="min-h-svh flex items-center justify-center bg-muted/30 px-4 py-12">
                <div className="w-full max-w-lg space-y-8">
                    <StatusHero
                        tone="info"
                        icon={Loader2}
                        iconClassName="animate-spin"
                        title="Verification in Progress"
                        description={<>Your identity verification for <span className="font-medium text-foreground">{statusData.companyName}</span> is being processed. This page will update automatically.</>}
                    />

                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground shrink-0" />
                                <div>
                                    <p className="text-sm font-medium">Awaiting verification result</p>
                                    <p className="text-xs text-muted-foreground">Checking status every few seconds...</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {restartError && (
                        <StatusMessage tone="error" icon={AlertCircle} description={restartError} />
                    )}

                    <div className="text-center space-y-2">
                        <p className="text-xs text-muted-foreground">Did not complete the identity check?</p>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleRestart}
                            disabled={isRestarting}
                        >
                            {isRestarting ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Restarting...
                                </>
                            ) : (
                                <>
                                    <RefreshCw className="h-4 w-4" />
                                    Restart identity verification
                                </>
                            )}
                        </Button>
                    </div>

                    <DashboardLink />
                </div>
            </div>
        );
    }

    if (statusData.status === "inReview") {
        return (
            <div className="min-h-svh flex items-center justify-center bg-muted/30 px-4 py-12">
                <div className="w-full max-w-lg space-y-8">
                    <StatusHero
                        tone="info"
                        icon={Clock}
                        title="Verification Under Review"
                        description={<>Your identity verification for <span className="font-medium text-foreground">{statusData.companyName}</span> is being reviewed manually. This page will update automatically once the review is complete.</>}
                    />

                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <Clock className="h-5 w-5 text-muted-foreground shrink-0" />
                                <div>
                                    <p className="text-sm font-medium">Manual review in progress</p>
                                    <p className="text-xs text-muted-foreground">This may take some time. You can safely close this page and check back later.</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <DashboardLink />
                </div>
            </div>
        );
    }

    if (statusData.status === "verified") {
        return (
            <div className="min-h-svh flex items-center justify-center bg-muted/30 px-4 py-12">
                <div className="w-full max-w-lg space-y-8">
                    <StatusHero
                        tone="success"
                        icon={ShieldCheck}
                        title="Verification Successful"
                        description={<><span className="font-medium text-foreground">{statusData.companyName}</span> has been successfully verified and is now active on the Peppol network.</>}
                    />

                    <StatusMessage
                        tone="success"
                        icon={ShieldCheck}
                        description="Identity verification completed successfully. You can close this page."
                    />

                    <DashboardLink />
                </div>
            </div>
        );
    }

    if (statusData.status === "error") {
        return (
            <div className="min-h-svh flex items-center justify-center bg-muted/30 px-4 py-12">
                <div className="w-full max-w-lg space-y-8">
                    <StatusHero
                        tone="error"
                        icon={AlertCircle}
                        title="Verification Could Not Be Completed"
                        description={<>We could not complete the verification flow for <span className="font-medium text-foreground">{statusData.companyName}</span>.</>}
                    />

                    <StatusMessage tone="error" icon={AlertCircle}>
                        <div className="text-sm text-pretty text-muted-foreground">
                            {statusData.errorMessage || "Identity verification may have succeeded, but we could not activate this company on the Peppol network. Please contact support@recommand.eu for assistance."}
                        </div>
                    </StatusMessage>

                    <DashboardLink />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-svh flex items-center justify-center bg-muted/30 px-4 py-12">
            <div className="w-full max-w-lg space-y-8">
                <StatusHero
                    tone="error"
                    icon={XCircle}
                    title="Verification Rejected"
                    description={<>The identity verification for <span className="font-medium text-foreground">{statusData.companyName}</span> was not successful.</>}
                />

                <StatusMessage tone="error" icon={XCircle}>
                    <div className="text-sm text-pretty text-muted-foreground">
                        {statusData.errorMessage || (
                            <>
                                Your identity could not be verified. Please contact <a href={`mailto:support@recommand.eu?subject=Company Verification Assistance for ${statusData.companyId}`} className="underline underline-offset-4 hover:text-primary/80">support@recommand.eu</a> for assistance.
                            </>
                        )}
                    </div>
                </StatusMessage>

                <DashboardLink />
            </div>
        </div>
    );
}
