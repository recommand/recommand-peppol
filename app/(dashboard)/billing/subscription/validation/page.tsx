import { PageTemplate } from "@core/components/page-template";
import { rc } from "@recommand/lib/client";
import { useEffect, useState } from "react";
import { useActiveTeam } from "@core/hooks/user";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import type { BillingProfile } from "@peppol/api/billing-profile";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "@core/hooks/use-translation";

const billingProfileClient = rc<BillingProfile>('v1');

export default function Page() {
  const [isLoading, setIsLoading] = useState(true);
  const [billingProfile, setBillingProfile] = useState<any>(null);
  const activeTeam = useActiveTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const fetchBillingProfile = async () => {
    if (!activeTeam?.id) return;

    try {
      const response = await billingProfileClient[':teamId']['billing-profile'].$get({
        param: { teamId: activeTeam.id }
      });
      const data = await response.json();

      if (data.success && data.billingProfile) {
        setBillingProfile(data.billingProfile);
        
        // If mandate is validated, redirect to subscription page
        if (data.billingProfile.isMandateValidated) {
          navigate('/billing/subscription');
        }
      }
    } catch (error) {
      console.error('Error fetching billing profile:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBillingProfile();
    // Set up polling every second
    const interval = setInterval(fetchBillingProfile, 1000);
    return () => clearInterval(interval);
  }, [activeTeam?.id]);

  if (isLoading) {
    return <PageTemplate
      breadcrumbs={[
        { label: t`Team Settings` },
        { label: t`Billing` },
        { label: t`Subscription` },
        { label: t`Validation` },
      ]}
    >
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    </PageTemplate>;
  }

  const paymentStatusLabels: Record<string, string> = {
    none: t`None`,
    open: t`Open`,
    pending: t`Pending`,
    authorized: t`Authorized`,
    paid: t`Paid`,
    canceled: t`Canceled`,
    expired: t`Expired`,
    failed: t`Failed`,
  };

  return <PageTemplate
    breadcrumbs={[
      { label: t`Team Settings` },
      { label: t`Billing` },
      { label: t`Subscription` },
      { label: t`Validation` },
    ]}
  >
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>{t`Validating Your Payment`}</CardTitle>
          <CardDescription>
            {t`Please wait while we validate your payment mandate.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {billingProfile && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                {billingProfile.firstPaymentStatus === 'paid' ? (
                  <CheckCircle className="h-5 w-5 text-folder" />
                ) : billingProfile.firstPaymentStatus === 'failed' || billingProfile.firstPaymentStatus === 'canceled' || billingProfile.firstPaymentStatus === 'expired' ? (
                  <XCircle className="h-5 w-5 text-danger" />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                )}
                <p className="text-muted-foreground">
                  {t`Payment Status: ${paymentStatusLabels[billingProfile.firstPaymentStatus] ?? billingProfile.firstPaymentStatus}`}
                </p>
              </div>

              <div className="flex items-center space-x-2">
                {billingProfile.isMandateValidated ? (
                  <CheckCircle className="h-5 w-5 text-folder" />
                ) : billingProfile.firstPaymentStatus === 'failed' || billingProfile.firstPaymentStatus === 'canceled' || billingProfile.firstPaymentStatus === 'expired' ? (
                  <XCircle className="h-5 w-5 text-danger" />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                )}
                <p className="text-muted-foreground">
                  {billingProfile.isMandateValidated
                    ? t`Mandate Status: Validated`
                    : t`Mandate Status: Not yet validated`}
                </p>
              </div>

              {(billingProfile.firstPaymentStatus === 'failed' || billingProfile.firstPaymentStatus === 'canceled' || billingProfile.firstPaymentStatus === 'expired') && (
                <div className="pt-4">
                  <Button onClick={() => navigate('/billing/subscription')}>
                    {t`Return to Subscription`}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  </PageTemplate>;
}
