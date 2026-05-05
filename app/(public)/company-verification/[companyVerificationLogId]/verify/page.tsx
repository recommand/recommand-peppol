import { rc } from "@recommand/lib/client";
import type { Companies } from "@peppol/api/companies";
import { useEffect, useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { stringifyActionFailure } from "@recommand/lib/utils";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Checkbox } from "@core/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@core/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@core/components/ui/radio-group";
import { StatusHero, StatusMessage } from "@recommand/components/status-feedback";
import { Loader2, AlertCircle, ShieldCheck, RefreshCw, XCircle } from "lucide-react";
import { ForwardSection } from "./forward-section";

const client = rc<Companies>("v1");
const VERIFICATION_ALREADY_SUBMITTED_ERROR = "This verification has already been submitted.";

type Representative = {
    firstName: string;
    lastName: string;
    function: string;
};

type VerificationStatus = "opened" | "idVerificationRequested" | "verified" | "rejected" | "error";
type PlaygroundVerificationOutcome = "verified" | "rejected";

type VerificationContext = {
    verificationLog: {
        id: string;
        status: VerificationStatus;
        companyName: string | null;
        errorMessage: string | null;
    };
    company: {
        id: string;
        name: string;
        enterpriseNumber: string | null;
    };
    isRepresentativeSelectionRequired: boolean;
    representatives: Representative[];
    isPlayground: boolean;
};

export default function Page() {
    const { companyVerificationLogId } = useParams<{ companyVerificationLogId: string }>();

    const [context, setContext] = useState<VerificationContext | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [selectedRepresentativeIndex, setSelectedRepresentativeIndex] = useState<string | null>(null);
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [acceptTerms, setAcceptTerms] = useState(false);
    const [confirmPermission, setConfirmPermission] = useState(false);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submittingPlaygroundOutcome, setSubmittingPlaygroundOutcome] = useState<PlaygroundVerificationOutcome | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [isRestarting, setIsRestarting] = useState(false);
    const [restartError, setRestartError] = useState<string | null>(null);

    const showRepresentativeSelection = context?.isRepresentativeSelectionRequired && context.representatives.length > 0;
    const noRepresentativesFound = context?.isRepresentativeSelectionRequired && context.representatives.length === 0;

    const selectedRepresentative = useMemo(() => {
        if (!showRepresentativeSelection || selectedRepresentativeIndex === null) return null;
        return context?.representatives[parseInt(selectedRepresentativeIndex)] ?? null;
    }, [showRepresentativeSelection, selectedRepresentativeIndex, context?.representatives]);

    const effectiveFirstName = noRepresentativesFound
        ? "UNKNOWN"
        : showRepresentativeSelection
            ? (selectedRepresentative?.firstName ?? "")
            : firstName;
    const effectiveLastName = noRepresentativesFound
        ? "UNKNOWN"
        : showRepresentativeSelection
            ? (selectedRepresentative?.lastName ?? "")
            : lastName;

    const isFormComplete =
        effectiveFirstName.trim() !== "" &&
        effectiveLastName.trim() !== "" &&
        acceptTerms &&
        confirmPermission;

    const statusPageUrl = companyVerificationLogId ? `/company-verification/${companyVerificationLogId}/status` : null;

    useEffect(() => {
        if (!companyVerificationLogId) return;

        const fetchContext = async () => {
            try {
                setIsLoading(true);
                setLoadError(null);
                const response = await client["companies"]["verification"][":companyVerificationLogId"]["context"].$get({
                    param: { companyVerificationLogId },
                });
                const json = await response.json();
                if (!json.success) {
                    setLoadError(stringifyActionFailure(json.errors));
                    return;
                }
                setContext(json as unknown as VerificationContext & { success: true; errors: undefined });
            } catch (error) {
                setLoadError("Failed to load verification data. Please try again.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchContext();
    }, [companyVerificationLogId]);

    const handlePlaygroundSubmit = async (outcome: PlaygroundVerificationOutcome) => {
        if (!companyVerificationLogId) return;

        try {
            setIsSubmitting(true);
            setSubmittingPlaygroundOutcome(outcome);
            setSubmitError(null);
            const response = await client["companies"]["verification"][":companyVerificationLogId"]["submit-playground-verification"].$post({
                param: { companyVerificationLogId },
                json: { outcome },
            });
            const json = await response.json();
            if (!json.success) {
                setSubmitError(stringifyActionFailure(json.errors));
                return;
            }
            window.location.href = `/company-verification/${companyVerificationLogId}/status`;
        } catch (error) {
            setSubmitError("An unexpected error occurred. Please try again.");
        } finally {
            setIsSubmitting(false);
            setSubmittingPlaygroundOutcome(null);
        }
    };

    const handleSubmit = async () => {
        if (!companyVerificationLogId || context?.isPlayground) return;

        if (!isFormComplete) return;

        try {
            setIsSubmitting(true);
            setSubmitError(null);
            const response = await client["companies"]["verification"][":companyVerificationLogId"]["submit-identity-form"].$post({
                param: { companyVerificationLogId },
                json: {
                    firstName: effectiveFirstName,
                    lastName: effectiveLastName,
                },
            });
            const json = await response.json();
            if (!json.success) {
                const errorMessage = stringifyActionFailure(json.errors);
                if (errorMessage === VERIFICATION_ALREADY_SUBMITTED_ERROR && statusPageUrl) {
                    window.location.href = statusPageUrl;
                    return;
                }
                setSubmitError(errorMessage);
                return;
            }
            if ("verificationUrl" in json) {
                window.location.href = json.verificationUrl as string;
            }
        } catch (error) {
            setSubmitError("An unexpected error occurred. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRestart = async () => {
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
    };

    if (isLoading) {
        return (
            <div className="min-h-svh flex items-center justify-center bg-muted/30">
                <div className="text-center space-y-4">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading verification...</p>
                </div>
            </div>
        );
    }

    if (loadError || !context) {
        return (
            <div className="min-h-svh flex items-center justify-center bg-muted/30 px-4">
                <div className="w-full max-w-md">
                    <StatusHero
                        tone="error"
                        icon={AlertCircle}
                        title="Verification unavailable"
                        description={loadError || "Verification data could not be loaded."}
                    />
                </div>
            </div>
        );
    }

    const companyName = context.company.name;

    if (context.verificationLog.status === "idVerificationRequested") {
        return (
            <div className="min-h-svh flex items-center justify-center bg-muted/30 px-4 py-12">
                <div className="w-full max-w-lg space-y-8">
                    <StatusHero
                        tone="info"
                        icon={Loader2}
                        iconClassName="animate-spin"
                        title="Verification Already in Progress"
                        description={<>A verification session has already been started for <span className="font-medium text-foreground">{companyName}</span>. If the previous link expired or was closed, you can request a new one below.</>}
                    />

                    {restartError && (
                        <StatusMessage tone="error" icon={AlertCircle} description={restartError} />
                    )}

                    <div className="space-y-3">
                        <Button
                            onClick={handleRestart}
                            disabled={isRestarting}
                            className="w-full"
                            size="lg"
                        >
                            {isRestarting ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Restarting...
                                </>
                            ) : (
                                <>
                                    <RefreshCw className="h-4 w-4" />
                                    Restart Identity Verification
                                </>
                            )}
                        </Button>

                        {statusPageUrl && (
                            <Button
                                variant="outline"
                                className="w-full"
                                onClick={() => {
                                    window.location.href = statusPageUrl;
                                }}
                            >
                                View Verification Status
                            </Button>
                        )}
                    </div>

                    <ForwardSection companyVerificationLogId={companyVerificationLogId!} />
                </div>
            </div>
        );
    }

    if (context.verificationLog.status === "verified" || context.verificationLog.status === "rejected" || context.verificationLog.status === "error") {
        return (
            <div className="min-h-svh flex items-center justify-center bg-muted/30 px-4 py-12">
                <div className="w-full max-w-lg space-y-8">
                    <StatusHero
                        tone="info"
                        icon={ShieldCheck}
                        title="Verification Already Finalized"
                        description={<>This verification for <span className="font-medium text-foreground">{companyName}</span> has already reached a final state.</>}
                    />

                    {statusPageUrl && (
                        <Button
                            className="w-full"
                            size="lg"
                            onClick={() => {
                                window.location.href = statusPageUrl;
                            }}
                        >
                            View Verification Status
                        </Button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-svh flex items-center justify-center bg-muted/30 px-4 py-12">
            <div className="w-full max-w-lg space-y-8">
                <div className="text-center space-y-2">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-2">
                        <ShieldCheck className="h-6 w-6 text-primary" />
                    </div>
                    <h1 className="text-2xl font-semibold tracking-tight">Company Verification</h1>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto text-balance">
                        {context.isPlayground ? (
                            <>Choose the simulated verification outcome for <span className="font-medium text-foreground">{companyName}</span> in this playground environment.</>
                        ) : (
                            <>Verify your identity as a representative of <span className="font-medium text-foreground">{companyName}</span> to activate this company on the Peppol network.</>
                        )}
                    </p>
                </div>

                {context.isPlayground ? (
                    <>
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Simulate Verification Result</CardTitle>
                                <CardDescription>
                                    This is a playground team, so identity verification is simulated. Choose whether the verification for <span className="font-medium text-foreground">{companyName}</span> should be accepted or rejected.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Button
                                        onClick={() => void handlePlaygroundSubmit("verified")}
                                        disabled={isSubmitting}
                                        className="w-full"
                                        size="lg"
                                    >
                                        {isSubmitting && submittingPlaygroundOutcome === "verified" ? (
                                            <>
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Accepting...
                                            </>
                                        ) : (
                                            <>
                                                <ShieldCheck className="h-4 w-4" />
                                                Accept
                                            </>
                                        )}
                                    </Button>

                                    <Button
                                        onClick={() => void handlePlaygroundSubmit("rejected")}
                                        disabled={isSubmitting}
                                        className="w-full"
                                        size="lg"
                                        variant="destructive"
                                    >
                                        {isSubmitting && submittingPlaygroundOutcome === "rejected" ? (
                                            <>
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Rejecting...
                                            </>
                                        ) : (
                                            <>
                                                <XCircle className="h-4 w-4" />
                                                Reject
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        {submitError && (
                            <StatusMessage tone="error" icon={AlertCircle} description={submitError} />
                        )}
                        <ForwardSection companyVerificationLogId={companyVerificationLogId!} />
                    </>
                ) : (
                    <>
                        {noRepresentativesFound ? (
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-base">Representative Details</CardTitle>
                                    <CardDescription>
                                        No registered representatives could be found for this company in the CBE registry. You can still proceed with identity verification but your request will be manually reviewed.
                                    </CardDescription>
                                </CardHeader>
                            </Card>
                        ) : (
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-base">Representative Details</CardTitle>
                                    <CardDescription>
                                        {showRepresentativeSelection
                                            ? "Select your name from the list of registered representatives."
                                            : "Enter the name of the person authorised to represent this company."
                                        }
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {showRepresentativeSelection ? (
                                        <RadioGroup
                                            value={selectedRepresentativeIndex ?? ""}
                                            onValueChange={(value) => setSelectedRepresentativeIndex(value)}
                                        >
                                            {context.representatives.map((rep, index) => (
                                                <label
                                                    key={index}
                                                    className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors hover:bg-muted/50 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
                                                >
                                                    <RadioGroupItem value={String(index)} />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium leading-none">
                                                            {rep.firstName} {rep.lastName}
                                                        </p>
                                                        {rep.function && (
                                                            <p className="text-xs text-muted-foreground mt-1">{rep.function}</p>
                                                        )}
                                                    </div>
                                                </label>
                                            ))}
                                        </RadioGroup>
                                    ) : (
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <div className="space-y-2">
                                                <Label htmlFor="firstName">First name</Label>
                                                <Input
                                                    id="firstName"
                                                    value={firstName}
                                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFirstName(e.target.value)}
                                                    placeholder="John"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="lastName">Last name</Label>
                                                <Input
                                                    id="lastName"
                                                    value={lastName}
                                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLastName(e.target.value)}
                                                    placeholder="Doe"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        <Card>
                            <CardContent className="pt-6 space-y-4">
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <Checkbox
                                        checked={acceptTerms}
                                        onCheckedChange={(checked) => setAcceptTerms(checked === true)}
                                        className="mt-0.5"
                                    />
                                    <span className="text-sm leading-snug text-muted-foreground">
                                        I accept the{" "}
                                        <a href="https://recommand.eu/en/legal/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 hover:text-primary/80">
                                            terms and conditions
                                        </a>{" "}
                                        of Recommand on behalf of <span className="font-medium text-foreground">{companyName}</span>.
                                    </span>
                                </label>

                                <label className="flex items-start gap-3 cursor-pointer">
                                    <Checkbox
                                        checked={confirmPermission}
                                        onCheckedChange={(checked) => setConfirmPermission(checked === true)}
                                        className="mt-0.5"
                                    />
                                    <span className="text-sm leading-snug text-muted-foreground">
                                        I confirm that I am authorised to act on behalf of <span className="font-medium text-foreground">{companyName}</span> on the Peppol network.
                                    </span>
                                </label>
                            </CardContent>
                        </Card>

                        {submitError && (
                            <StatusMessage tone="error" icon={AlertCircle} description={submitError} />
                        )}

                        <Button
                            onClick={handleSubmit}
                            disabled={!isFormComplete || isSubmitting}
                            className="w-full"
                            size="lg"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Verifying...
                                </>
                            ) : (
                                <>
                                    <ShieldCheck className="h-4 w-4" />
                                    Continue to Identity Verification
                                </>
                            )}
                        </Button>

                        <p className="text-xs text-center text-muted-foreground">
                            You will be redirected to our verification partner to complete the identity check.
                        </p>
                        <ForwardSection companyVerificationLogId={companyVerificationLogId!} />
                    </>
                )}
            </div>
        </div>
    );
}
