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

export function shouldRegisterWithSmp({
    isPlayground,
    useTestNetwork,
    isSmpRecipient,
    isVerified,
    verificationRequirements,
}: {
    isPlayground?: boolean;
    useTestNetwork?: boolean;
    isSmpRecipient: boolean;
    isVerified: boolean;
    verificationRequirements?: string;
}): boolean {
    // Only allow registration with the SMP if the company is an SMP recipient and is verified
    const requiresVerification = verificationRequirements === "strict";
    return shouldInteractWithPeppolNetwork({ isPlayground, useTestNetwork }) && isSmpRecipient && (!requiresVerification || isVerified);
}
