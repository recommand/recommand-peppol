import { BillingProfileForm, DEFAULT_BILLING_PROFILE_FORM_DATA, type BillingProfileFormData } from "../billing-profile-form";
import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { updateBillingProfile, fetchBillingProfile } from "@peppol/lib/billing";
import { useActiveTeam } from "@core/hooks/user";
import type { BillingProfileData } from "@peppol/api/billing-profile";
import PlaygroundOption from "./playground-option";
import { CreateTeamButton } from "@core/components/create-team-button";
import { AsyncButton } from "@core/components/async-button";
import { useTranslation } from "@core/hooks/use-translation";

export default function BillingOnboarding({ onComplete }: { onComplete: () => Promise<void> }) {
    const { t } = useTranslation();
    const [profileForm, setProfileForm] = useState<BillingProfileFormData>(DEFAULT_BILLING_PROFILE_FORM_DATA);
    const [billingProfile, setBillingProfile] = useState<BillingProfileData | null>(null);
    const [isProcessingPayment, setIsProcessingPayment] = useState(false);
    const activeTeam = useActiveTeam();

    const profileFormRef = useRef<BillingProfileFormData>(DEFAULT_BILLING_PROFILE_FORM_DATA);
    profileFormRef.current = profileForm;

    useEffect(() => {
        const checkPaymentMandate = async () => {
            if (!activeTeam?.id) return;

            const billingProfile = await fetchBillingProfile(activeTeam.id);

            setBillingProfile(billingProfile);

            if (billingProfile) {
                setProfileForm({
                    companyName: profileFormRef.current.companyName.length > 0 ? profileFormRef.current.companyName : billingProfile?.companyName ?? "",
                    address: profileFormRef.current.address.length > 0 ? profileFormRef.current.address : billingProfile?.address ?? "",
                    postalCode: profileFormRef.current.postalCode.length > 0 ? profileFormRef.current.postalCode : billingProfile?.postalCode ?? "",
                    city: profileFormRef.current.city.length > 0 ? profileFormRef.current.city : billingProfile?.city ?? "",
                    country: profileFormRef.current.country != "BE" ? profileFormRef.current.country : billingProfile?.country ?? "BE",
                    vatNumber: profileFormRef.current.vatNumber && profileFormRef.current.vatNumber.length > 0 ? profileFormRef.current.vatNumber : billingProfile?.vatNumber ?? "",
                    billingEmail: profileFormRef.current.billingEmail && profileFormRef.current.billingEmail.length > 0 ? profileFormRef.current.billingEmail : billingProfile?.billingEmail ?? null,
                    billingPeppolAddress: profileFormRef.current.billingPeppolAddress && profileFormRef.current.billingPeppolAddress.length > 0 ? profileFormRef.current.billingPeppolAddress : billingProfile?.billingPeppolAddress ?? null,
                });
            }

            if (billingProfile?.isMandateValidated) {
                await onComplete();
            }
        };

        checkPaymentMandate();

        const interval = setInterval(checkPaymentMandate, 5000);
        return () => clearInterval(interval);
    }, [activeTeam?.id]);

    if (!activeTeam?.id) {
        return <div className="text-center space-y-4">
            <p>{t`You must be in a team to complete this step`}</p>
            <CreateTeamButton />
        </div>;
    }

    return <div>
        <BillingProfileForm
            profileForm={profileForm}
            onChange={setProfileForm}
        />
        {billingProfile && !billingProfile.isMandateValidated && (
            <div className="flex items-center gap-2 pb-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t`Validating payment mandate...`}
            </div>
        )}
        <div className="flex justify-end">
            <AsyncButton
                disabled={isProcessingPayment}
                onClick={async () => {
                    setIsProcessingPayment(true);
                    try {
                        await updateBillingProfile(activeTeam.id, profileForm);
                    } catch (error) {
                        console.error(error);
                    } finally {
                        setIsProcessingPayment(false);
                    }
                    // Don't call onComplete here, it should only be called when payment has been set up
                }}
            >
                {t`Setup Payment Method`}
            </AsyncButton>
        </div>
        <PlaygroundOption
            buttonText={t`Skip Billing`}
            description={t`Skip billing setup by creating a playground to test your Peppol API integrations without billing requirements, or switch to another team.`}
        />
    </div>;
}
