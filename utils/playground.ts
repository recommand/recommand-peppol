import type { SmpProviderId } from "@peppol/data/peppol-providers";

/**
 * Whether a company in this team ever reaches a Peppol network. A playground team
 * simulates the network unless it was put on the test network; every other team is
 * on the production network.
 */
export function shouldInteractWithPeppolNetwork({
    isPlayground,
    useTestNetwork,
}: {
    isPlayground?: boolean | null;
    useTestNetwork?: boolean | null;
}): boolean {
    isPlayground = isPlayground ?? false;
    useTestNetwork = useTestNetwork ?? false;
    if(isPlayground){
        if(useTestNetwork){
            return true;
        }else{
            return false;
        }
    }else{
        return true;
    }
}

/**
 * Whether a company has to be verified before it is published on its SMP or sends.
 * The team's verification level decides, except on the French production network:
 * the French platform takes a participant only once its KYC is done, and that KYC
 * is collected by our company verification. A company there needs verification
 * whatever its team's level allows; lax and trusted teams included.
 */
export function requiresCompanyVerification({
    verificationRequirements,
    smpProvider,
    useTestNetwork,
}: {
    verificationRequirements?: string | null;
    smpProvider: SmpProviderId;
    useTestNetwork?: boolean | null;
}): boolean {
    if (verificationRequirements === "strict") {
        return true;
    }
    return smpProvider === "at-shared-smp-fr" && !useTestNetwork;
}

export function shouldRegisterWithSmp({
    isPlayground,
    useTestNetwork,
    isSmpRecipient,
    isVerified,
    verificationRequirements,
    smpProvider,
}: {
    isPlayground?: boolean;
    useTestNetwork?: boolean;
    isSmpRecipient: boolean;
    isVerified: boolean;
    verificationRequirements?: string;
    smpProvider: SmpProviderId;
}): boolean {
    // Only allow registration with the SMP if the company is an SMP recipient and is verified
    const requiresVerification = requiresCompanyVerification({ verificationRequirements, smpProvider, useTestNetwork });
    return shouldInteractWithPeppolNetwork({ isPlayground, useTestNetwork }) && isSmpRecipient && (!requiresVerification || isVerified);
}

/**
 * The same rule for screens, which know a company's country and the team's network
 * but not the company's providers: a French company is on the French providers
 * (resolveDefaultPeppolProviders), so on the production network it has to be
 * verified whatever its team's level. On the test network the French platform skips
 * KYC and the team's level decides, as it does on the server.
 */
export function isVerificationEnforced({
    verificationRequirements,
    country,
    useTestNetwork,
}: {
    verificationRequirements?: string | null;
    country?: string | null;
    useTestNetwork: boolean | null | undefined;
}): boolean {
    return requiresCompanyVerification({
        verificationRequirements,
        smpProvider: country?.toUpperCase() === "FR" ? "at-shared-smp-fr" : "recommand-smp1",
        useTestNetwork,
    });
}
