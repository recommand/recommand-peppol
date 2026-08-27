import { PageTemplate } from "@core/components/page-template";
import { rc } from "@recommand/lib/client";
import type { Subscription } from "api/subscription";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@core/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Progress } from "@core/components/ui/progress";
import { Separator } from "@core/components/ui/separator";
import { toast } from "@core/components/ui/sonner";
import { useActiveTeam } from "@core/hooks/user";
import {
  Loader2,
  XCircle,
  CheckCircle,
  Pencil,
  Check,
  CreditCard,
  Calendar,
  FileText,
  TrendingUp,
  AlertTriangle,
  Receipt,
  Download,
} from "lucide-react";
import type { Subscription as SubscriptionType } from "@peppol/data/subscriptions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@core/components/ui/alert-dialog";
import type {
  BillingProfile,
  BillingProfileData,
} from "@peppol/api/billing-profile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@core/components/ui/dialog";
import {
  BillingProfileForm,
  DEFAULT_BILLING_PROFILE_FORM_DATA,
  type BillingProfileFormData,
} from "@peppol/components/billing-profile-form";
import { PlansGrid } from "@peppol/components/plans-grid";
import {
  updateBillingProfile,
  fetchBillingProfile as fetchBillingProfileFromApi,
  updatePaymentMethod,
} from "@peppol/lib/billing";
import { useIsPlayground } from "@peppol/lib/client/playgrounds";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@core/components/ui/table";
import { useTranslation } from "@core/hooks/use-translation";
import { createRegionNames, regionDisplayName } from "@core/lib/regions";

const subscriptionClient = rc<Subscription>("v1");
const billingProfileClient = rc<BillingProfile>("v1");

export default function Page() {
  const { t, language } = useTranslation();
  const regionNames = useMemo(
    () => createRegionNames(language),
    [language]
  );
  const [isLoading, setIsLoading] = useState(true);
  const [currentSubscription, setCurrentSubscription] =
    useState<SubscriptionType | null>(null);
  const [futureSubscription, setFutureSubscription] =
    useState<SubscriptionType | null>(null);
  const [currentUsage, setCurrentUsage] = useState(-1);
  const [billingProfile, setBillingProfile] =
    useState<BillingProfileData | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<BillingProfileFormData>(
    DEFAULT_BILLING_PROFILE_FORM_DATA
  );
  const [billingEvents, setBillingEvents] = useState<any[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const activeTeam = useActiveTeam();
  const isPlayground = useIsPlayground();

  const fetchSubscription = async () => {
    if (!activeTeam?.id) {
      setIsLoading(false);
      return;
    }

    try {
      const response = await subscriptionClient[":teamId"]["subscription"].$get(
        {
          param: { teamId: activeTeam.id },
        }
      );
      const data = await response.json();

      if (!data.success) {
        setCurrentSubscription(null);
        setFutureSubscription(null);
        return;
      }

      if (data.subscription) {
        setCurrentSubscription({
          ...data.subscription,
          createdAt: new Date(data.subscription.createdAt),
          updatedAt: new Date(data.subscription.updatedAt),
          startDate: new Date(data.subscription.startDate),
          endDate: data.subscription.endDate
            ? new Date(data.subscription.endDate)
            : null,
          lastBilledAt: data.subscription.lastBilledAt
            ? new Date(data.subscription.lastBilledAt)
            : null,
        });
      } else {
        setCurrentSubscription(null);
      }

      if (data.futureSubscription) {
        setFutureSubscription({
          ...data.futureSubscription,
          createdAt: new Date(data.futureSubscription.createdAt),
          updatedAt: new Date(data.futureSubscription.updatedAt),
          startDate: new Date(data.futureSubscription.startDate),
          endDate: data.futureSubscription.endDate
            ? new Date(data.futureSubscription.endDate)
            : null,
          lastBilledAt: data.futureSubscription.lastBilledAt
            ? new Date(data.futureSubscription.lastBilledAt)
            : null,
        });
      } else {
        setFutureSubscription(null);
      }
    } catch (error) {
      console.error("Error fetching subscription:", error);
      toast.error(t`Failed to load subscription`);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCurrentUsage = async () => {
    if (!activeTeam?.id) return;

    try {
      const response = await billingProfileClient[":teamId"]["billing-profile"][
        "current-usage"
      ].$get({
        param: { teamId: activeTeam.id },
      });
      const data = await response.json();

      if (data.success) {
        setCurrentUsage(data.usage);
      }
    } catch (error) {
      console.error("Error fetching current usage:", error);
      toast.error(t`Failed to load current usage`);
    }
  };

  const fetchBillingProfile = async () => {
    if (!activeTeam?.id) return;

    const billingProfile = await fetchBillingProfileFromApi(activeTeam.id);
    if (billingProfile) {
      setBillingProfile(billingProfile);
      setProfileForm({
        companyName: billingProfile.companyName,
        address: billingProfile.address,
        postalCode: billingProfile.postalCode,
        city: billingProfile.city,
        country: billingProfile.country,
        vatNumber: billingProfile.vatNumber || "",
        billingEmail: billingProfile.billingEmail || null,
        billingPeppolAddress: billingProfile.billingPeppolAddress || null,
      });
    } else {
      setBillingProfile(null);
    }
  };

  const fetchBillingEvents = async () => {
    if (!activeTeam?.id) return;

    setIsLoadingEvents(true);
    try {
      const response = await subscriptionClient[":teamId"]["subscription"][
        "billing-events"
      ].$get({
        param: { teamId: activeTeam.id },
      });
      const data = await response.json();

      if (data.success && data.events) {
        setBillingEvents(
          data.events.map((event: any) => ({
            ...event,
            billingDate: new Date(event.billingDate),
            billingPeriodStart: new Date(event.billingPeriodStart),
            billingPeriodEnd: new Date(event.billingPeriodEnd),
            createdAt: new Date(event.createdAt),
            updatedAt: new Date(event.updatedAt),
            paymentDate: event.paymentDate ? new Date(event.paymentDate) : null,
          }))
        );
      }
    } catch (error) {
      console.error("Error fetching billing events:", error);
      toast.error(t`Failed to load billing events`);
    } finally {
      setIsLoadingEvents(false);
    }
  };

  useEffect(() => {
    if (isPlayground) {
      return;
    }
    fetchSubscription();
    fetchCurrentUsage();
    fetchBillingProfile();
    fetchBillingEvents();
  }, [activeTeam?.id, isPlayground]);

  const handleCancelSubscription = async () => {
    if (!activeTeam?.id) return;

    try {
      const response = await subscriptionClient[
        ":teamId"
      ].subscription.cancel.$post({
        param: { teamId: activeTeam.id },
      });

      const data = await response.json();
      fetchSubscription();
      toast.success(t`Subscription cancelled successfully`);
    } catch (error) {
      toast.error(t`Failed to cancel subscription`);
    }
  };

  const handleUpdateProfile = async () => {
    if (!activeTeam?.id) return;

    await updateBillingProfile(activeTeam.id, profileForm, (billingProfile) => {
      setBillingProfile(billingProfile);
      setIsEditingProfile(false);
    });
  };

  if (isLoading) {
    return (
      <PageTemplate
        breadcrumbs={[
          { label: t`Team Settings` },
          { label: t`Billing` },
          { label: t`Subscription` },
        ]}
      >
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </PageTemplate>
    );
  }

  if (isPlayground) {
    return (
      <PageTemplate
        breadcrumbs={[
          { label: t`Team Settings` },
          { label: t`Billing` },
          { label: t`Subscription` },
        ]}
      >
        <div className="flex items-center justify-center py-8 text-center">
          <p className="text-muted-foreground">
            {t`This is a playground environment. Playground usage is entirely free of charge.`}
            <br />
            {t`Switch to a production team to manage your subscription.`}
          </p>
        </div>
      </PageTemplate>
    );
  }

  return (
    <PageTemplate
      breadcrumbs={[
        { label: t`Team Settings` },
        { label: t`Billing` },
        { label: t`Subscription` },
      ]}
      description={t`Manage your subscription plan and billing information`}
    >
      <div className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2 items-start">
          <div className="space-y-6">
            {currentSubscription ? (
              <Card className="border-l-4 border-l-primary">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xl flex items-center gap-2">
                        {/* <Shield className="h-5 w-5 text-primary" /> */}
                        {t`${t(currentSubscription.planName)} Plan`}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {t`Active subscription with full access`}
                      </CardDescription>
                    </div>
                    <Badge variant="success">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      {t`Active`}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Usage Progress */}
                  {currentUsage !== -1 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">
                            {t`Document Usage`}
                          </span>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {currentSubscription.billingConfig
                            .includedMonthlyDocuments === 0
                            ? t`${currentUsage} documents`
                            : `${currentUsage} / ${currentSubscription.billingConfig.includedMonthlyDocuments}`}
                        </span>
                      </div>
                      {currentSubscription.billingConfig
                        .includedMonthlyDocuments > 0 ? (
                        <>
                          <Progress
                            value={
                              (currentUsage /
                                currentSubscription.billingConfig
                                  .includedMonthlyDocuments) *
                              100
                            }
                            className="h-2"
                          />
                          <p className="text-xs text-muted-foreground">
                            {currentSubscription.billingConfig
                              .includedMonthlyDocuments -
                              currentUsage >
                              0
                              ? t`${currentSubscription.billingConfig.includedMonthlyDocuments - currentUsage} documents remaining this month`
                              : t`${currentUsage - currentSubscription.billingConfig.includedMonthlyDocuments} documents over limit`}
                          </p>
                        </>
                      ) : (
                        <div className="p-3 bg-muted/50 rounded-lg">
                          <p className="text-xs text-muted-foreground">
                            {t`Unlimited usage - pay per document transmitted (€${currentSubscription.billingConfig.documentOveragePrice.toFixed(2)} each)`}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <Separator />

                  {/* Plan Details Grid */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium mb-1">
                          <CreditCard className="h-4 w-4 text-muted-foreground" />
                          {currentSubscription.billingConfig.basePrice === 0
                            ? t`Pricing Model`
                            : t`Monthly Price`}
                        </div>
                        {currentSubscription.billingConfig.basePrice === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            {t`Volume-based`}
                          </p>
                        ) : (
                          <p className="text-2xl font-bold text-primary">
                            €
                            {currentSubscription.billingConfig.basePrice.toFixed(
                              2
                            )}
                          </p>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium mb-1">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          {t`Start Date`}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {new Date(
                            currentSubscription.startDate
                          ).toLocaleDateString(language)}
                        </p>
                      </div>
                      {currentSubscription.endDate && (
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium mb-1">
                            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                            {t`End Date`}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {new Date(
                              currentSubscription.endDate
                            ).toLocaleDateString(language)}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium mb-1">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          {t`Included Documents`}
                        </div>
                        {currentSubscription.billingConfig
                          .includedMonthlyDocuments === 0 ? (
                          <p className="text-sm text-muted-foreground">∞</p>
                        ) : (
                          <p className="text-lg font-semibold">
                            {
                              currentSubscription.billingConfig
                                .includedMonthlyDocuments
                            }
                            <span className="text-sm font-normal text-muted-foreground ml-1">
                              {t`per month`}
                            </span>
                          </p>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium mb-1">
                          <TrendingUp className="h-4 w-4 text-muted-foreground" />
                          {currentSubscription.billingConfig
                            .includedMonthlyDocuments === 0
                            ? t`Price per Document`
                            : t`Overage Rate`}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          €
                          {currentSubscription.billingConfig.documentOveragePrice.toFixed(
                            2
                          )}{" "}
                          {t`per document`}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
                {(!currentSubscription.endDate || futureSubscription) && <CardFooter className="pt-6">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive">
                        <XCircle className="h-4 w-4" />
                        {t`Cancel Subscription`}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5 text-destructive" />
                          {t`Cancel Subscription?`}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t`You will lose access to your current plan features at the end of the current month.`}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t`Keep Subscription`}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleCancelSubscription}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          <CheckCircle className="h-4 w-4" />
                          {t`Yes, Cancel Subscription`}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardFooter>}
              </Card>
            ) : (
              <Card className="border-dashed border-2 border-muted-foreground/25">
                <CardHeader className="text-center pb-2">
                  <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                    <CreditCard className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <CardTitle className="text-xl">
                    {t`No Active Subscription`}
                  </CardTitle>
                  <CardDescription className="text-base">
                    {t`Choose a plan below to get started with Peppol document transmission`}
                  </CardDescription>
                </CardHeader>
              </Card>
            )}
            {futureSubscription && (
              <Card className="border-l-4">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xl flex items-center gap-2">
                        {t`${t(futureSubscription.planName)} Plan`}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {t`Scheduled subscription change`}
                      </CardDescription>
                    </div>
                    <Badge variant="secondary">
                      <Calendar className="h-3 w-3 mr-1" />
                      {t`Scheduled`}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium mb-1">
                          <CreditCard className="h-4 w-4 text-muted-foreground" />
                          {futureSubscription.billingConfig.basePrice === 0
                            ? t`Pricing Model`
                            : t`Monthly Price`}
                        </div>
                        {futureSubscription.billingConfig.basePrice === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            {t`Volume-based`}
                          </p>
                        ) : (
                          <p className="text-2xl font-bold text-primary">
                            €
                            {futureSubscription.billingConfig.basePrice.toFixed(
                              2
                            )}
                          </p>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium mb-1">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          {t`Start Date`}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {new Date(
                            futureSubscription.startDate
                          ).toLocaleDateString(language)}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium mb-1">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          {t`Included Documents`}
                        </div>
                        {futureSubscription.billingConfig
                          .includedMonthlyDocuments === 0 ? (
                          <p className="text-sm text-muted-foreground">∞</p>
                        ) : (
                          <p className="text-lg font-semibold">
                            {
                              futureSubscription.billingConfig
                                .includedMonthlyDocuments
                            }
                            <span className="text-sm font-normal text-muted-foreground ml-1">
                              {t`per month`}
                            </span>
                          </p>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium mb-1">
                          <TrendingUp className="h-4 w-4 text-muted-foreground" />
                          {futureSubscription.billingConfig
                            .includedMonthlyDocuments === 0
                            ? t`Price per Document`
                            : t`Overage Rate`}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          €
                          {futureSubscription.billingConfig.documentOveragePrice.toFixed(
                            2
                          )}{" "}
                          {t`per document`}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="h-4 w-4" />
                  {t`Billing History`}
                </CardTitle>
                <CardDescription>
                  {t`Overview of all invoices and billing events`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingEvents ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : billingEvents.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground">
                      {t`No billing events found`}
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t`Invoice #`}</TableHead>
                        <TableHead>{t`Billing Date`}</TableHead>
                        <TableHead>{t`Period`}</TableHead>
                        <TableHead>{t`Documents`}</TableHead>
                        <TableHead>{t`Amount (excl. VAT)`}</TableHead>
                        <TableHead>{t`VAT`}</TableHead>
                        <TableHead>{t`Total`}</TableHead>
                        <TableHead>{t`Payment Status`}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {billingEvents.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className="font-mono">
                            {event.invoiceId && event.invoiceReference && activeTeam?.id ? (
                              <a
                                href={`/api/v1/${activeTeam.id}/subscription/billing-events/${event.id}/download?generatePdf=when_no_pdf_attachment`}
                                className="text-primary hover:underline flex items-center gap-1.5 font-medium"
                                title={t`Download invoice (UBL/PDF)`}
                                download
                              >
                                <Download className="h-3.5 w-3.5" />
                                {`${event.invoiceReference.toString()}`}
                              </a>
                            ) : event.invoiceReference ? (
                              `${event.invoiceReference.toString()}`
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell>
                            {event.billingDate.toLocaleDateString(language)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {event.billingPeriodStart.toLocaleDateString(language, { timeZone: "UTC" })} -{" "}
                            {event.billingPeriodEnd.toLocaleDateString(language, { timeZone: "UTC" })}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <span className="text-sm">
                                {t`${parseFloat(event.usedQty).toLocaleString(language)} total`}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {parseFloat(event.usedQtyIncoming).toLocaleString(language)}{" "}
                                {t`incoming`},{" "}
                                {parseFloat(event.usedQtyOutgoing).toLocaleString(language)}{" "}
                                {t`outgoing`}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            €{parseFloat(event.totalAmountExcl).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <span className="text-sm">
                                €{parseFloat(event.vatAmount).toFixed(2)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {parseFloat(event.vatPercentage).toFixed(1)}% (
                                {event.vatCategory})
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="font-semibold">
                            €{parseFloat(event.totalAmountIncl).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                event.paymentStatus === "paid"
                                  ? "success"
                                  : event.paymentStatus === "pending" ||
                                    event.paymentStatus === "open"
                                    ? "secondary"
                                    : event.paymentStatus === "failed" ||
                                      event.paymentStatus === "expired" ||
                                      event.paymentStatus === "canceled"
                                      ? "destructive"
                                      : "outline"
                              }
                            >
                              {event.paymentStatus === "paid" && (
                                <CheckCircle className="h-3 w-3 mr-1" />
                              )}
                              {event.paymentStatus === "none" && (
                                <AlertTriangle className="h-3 w-3 mr-1" />
                              )}
                              {event.paymentStatus === "paid"
                                ? t`Paid`
                                : event.paymentStatus === "pending"
                                  ? t`Pending`
                                  : event.paymentStatus === "open"
                                    ? t`Open`
                                    : event.paymentStatus === "failed"
                                      ? t`Failed`
                                      : event.paymentStatus === "expired"
                                        ? t`Expired`
                                        : event.paymentStatus === "canceled"
                                          ? t`Canceled`
                                          : event.paymentStatus === "none"
                                            ? t`None`
                                            : event.paymentStatus}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <div>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4" />
                      {t`Billing Profile`}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {t`Your billing information`}
                    </CardDescription>
                  </div>
                  {billingProfile && (
                    <Badge
                      variant={
                        billingProfile.isMandateValidated
                          ? "secondary"
                          : "destructive"
                      }
                    >
                      {billingProfile.isMandateValidated ? (
                        <>
                          <Check className="h-3 w-3 mr-1" />
                          {t`Verified`}
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          {t`Pending`}
                        </>
                      )}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {billingProfile ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-medium text-foreground mb-1">
                        {t`Company Name`}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {billingProfile.companyName}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-foreground mb-1">
                        {t`Address`}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {billingProfile.address}
                        <br />
                        {billingProfile.postalCode} {billingProfile.city}
                        <br />
                        {regionDisplayName(regionNames, billingProfile.country, billingProfile.country)}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-foreground mb-1">{t`Billing Email`}</h3>
                      <p className="text-sm text-muted-foreground">
                        {billingProfile.billingEmail || t`Not set`}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-foreground mb-1">{t`Billing Peppol Address`}</h3>
                      <p className="text-sm text-muted-foreground">
                        {billingProfile.billingPeppolAddress || t`Not set`}
                      </p>
                    </div>
                    {billingProfile.vatNumber && (
                      <div>
                        <h3 className="text-sm font-medium text-foreground mb-1">
                          {t`VAT Number`}
                        </h3>
                        <p className="text-sm text-muted-foreground font-mono">
                          {billingProfile.vatNumber}
                        </p>
                      </div>
                    )}

                    <Separator />

                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                      {billingProfile.isMandateValidated ? (
                        <CheckCircle className="h-4 w-4 text-folder mt-0.5 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      )}
                      <div className="flex-1">
                        <p className="text-sm font-medium">
                          {t`Payment Mandate`}{" "}
                          {billingProfile.isMandateValidated
                            ? t`Verified`
                            : t`Pending`}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {billingProfile.isMandateValidated
                            ? t`Your payment method is set up and ready for billing.`
                            : t`Complete payment setup to activate your subscription.`}
                        </p>
                      </div>
                      {activeTeam?.id && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updatePaymentMethod(activeTeam.id)}
                        >
                          <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                          {billingProfile.isMandateValidated ? t`Update Payment Method` : t`Set Up Payment Method`}
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                      <CreditCard className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t`No billing profile set up yet.`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t`Set up your billing profile to manage subscriptions.`}
                    </p>
                  </div>
                )}
              </CardContent>
              <CardFooter>
                {/* <Button
              onClick={() => billingProfileClient[':teamId']['billing-profile']['end-billing-cycle'].$post({
                param: { teamId: activeTeam!.id }
              })}
            >Test billing period end</Button> */}
                <Dialog
                  open={isEditingProfile}
                  onOpenChange={setIsEditingProfile}
                >
                  <DialogTrigger asChild>
                    <Button>
                      {billingProfile && !billingProfile.isMandateValidated && (
                        <CreditCard className="h-4 w-4 mr-2" />
                      )}
                      {((billingProfile && billingProfile.isMandateValidated) ||
                        !billingProfile) && <Pencil className="h-4 w-4 mr-2" />}
                      {billingProfile
                        ? t`Edit Billing Profile`
                        : t`Set Up Billing Profile`}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>
                        {billingProfile
                          ? t`Edit Billing Profile`
                          : t`Set Up Billing Profile`}
                      </DialogTitle>
                      <DialogDescription>
                        {t`Update your billing information`}
                      </DialogDescription>
                    </DialogHeader>
                    <BillingProfileForm
                      profileForm={profileForm}
                      onChange={setProfileForm}
                      onCancel={() => setIsEditingProfile(false)}
                      onSubmit={handleUpdateProfile}
                    />
                  </DialogContent>
                </Dialog>
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>

      {activeTeam?.id && (
        <PlansGrid
          currentSubscription={currentSubscription}
          teamId={activeTeam.id}
          onSubscriptionUpdate={(subscription) => {
            setCurrentSubscription(subscription);
            fetchSubscription();
          }}
        />
      )}
    </PageTemplate>
  );
}
