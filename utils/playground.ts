function shouldInteractWithPeppolNetwork({
    isPlayground,
    useTestNetwork,
}: {
    isPlayground?: boolean;
    useTestNetwork?: boolean;
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
    smpProvider,
}: {
    isPlayground?: boolean;
    useTestNetwork?: boolean;
    isSmpRecipient: boolean;
    isVerified: boolean;
    verificationRequirements?: string;
    smpProvider?: string;
}): boolean {
    // Recipients are registered in the SMP. Arratech also needs a participant for
    // send-only companies (classified EXTERNAL when the identifier already lives
    // on another SMP) so KYC and sending still have a record to attach to.
    const requiresVerification = verificationRequirements === "strict";
    const needsSmpRecord = isSmpRecipient || smpProvider === "at-shared-smp-fr";
    return shouldInteractWithPeppolNetwork({ isPlayground, useTestNetwork }) && needsSmpRecord && (!requiresVerification || isVerified);
}