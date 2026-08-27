import { useEffect, useState } from "react";
import { Button } from "@core/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@core/components/ui/toggle-group";
import { availablePlans, type Plan } from "@peppol/data/plans";
import type { Subscription as SubscriptionType } from "@peppol/data/subscriptions";
import { toast } from "@core/components/ui/sonner";
import { rc } from "@recommand/lib/client";
import type { Subscription } from "api/subscription";
import { stringifyActionFailure } from "@recommand/lib/utils";
import { Check } from "lucide-react";
import { cn } from "@core/lib/utils";
import { useTranslation } from "@core/hooks/use-translation";

const subscriptionClient = rc<Subscription>("v1");

const PROFESSIONAL_PREFIX = "professional";
const MOST_POPULAR_PLAN_ID = "professional";

const planTaglines: Record<string, string> = {
  developer: "Try out Peppol, no credit card needed",
  starter: "For small businesses sending every month",
  professional: "For growing businesses with higher volumes",
};

interface PlansGridProps {
  currentSubscription: SubscriptionType | null;
  teamId: string;
  onSubscriptionUpdate?: (subscription: SubscriptionType) => void;
  showHeader?: boolean;
}

export function PlansGrid({
  currentSubscription,
  teamId,
  onSubscriptionUpdate,
  showHeader = true,
}: PlansGridProps) {
  const { t, language } = useTranslation();
  const professionalTiers = availablePlans.filter((plan) =>
    plan.id.startsWith(PROFESSIONAL_PREFIX)
  );
  const basePlans = availablePlans.filter(
    (plan) => !plan.id.startsWith(PROFESSIONAL_PREFIX)
  );

  const [selectedTierId, setSelectedTierId] = useState<string>(
    professionalTiers[0]?.id ?? ""
  );

  useEffect(() => {
    const currentTier = professionalTiers.find(
      (tier) => tier.id === currentSubscription?.planId
    );
    if (currentTier) {
      setSelectedTierId(currentTier.id);
    }
  }, [currentSubscription?.planId]);

  const selectedTier =
    professionalTiers.find((tier) => tier.id === selectedTierId) ??
    professionalTiers[0];

  const handleStartSubscription = async (planId: string) => {
    try {
      const response = await subscriptionClient[":teamId"].subscription.$post({
        param: { teamId: teamId },
        json: { planId },
      });

      const data = await response.json();
      if (data.success) {
        onSubscriptionUpdate?.({
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
        toast.success(t`Subscription updated successfully`);
      } else {
        toast.error(stringifyActionFailure(data.errors));
      }
    } catch (error) {
      toast.error(t`Failed to update subscription`);
    }
  };

  const isCurrentPlan = (planId: string) =>
    currentSubscription?.planId === planId;

  const renderPlanCard = (plan: Plan, options?: { tierSelector?: boolean }) => {
    const isPopular =
      (options?.tierSelector ? PROFESSIONAL_PREFIX : plan.id) ===
      MOST_POPULAR_PLAN_ID;
    const isCurrent = isCurrentPlan(plan.id);
    const isActiveCurrent = isCurrent && !currentSubscription?.endDate;
    const tagline = options?.tierSelector
      ? t`For growing businesses with higher volumes`
      : plan.id === "developer"
        ? t`Try out Peppol, no credit card needed`
        : plan.id === "starter"
          ? t`For small businesses sending every month`
          : t(planTaglines[plan.id]);
    const displayName = options?.tierSelector ? t`Professional` : t(plan.name);

    return (
      <Card
        key={options?.tierSelector ? PROFESSIONAL_PREFIX : plan.id}
        className={cn(
          "relative flex flex-col",
          isPopular && "border-primary shadow-md",
          !isPopular && isCurrent && "border-primary/50"
        )}
      >
        {isPopular && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <Badge>{t`Most popular`}</Badge>
          </div>
        )}
        {isCurrent && (
          <div className="absolute -top-3 right-4">
            <Badge variant="secondary">
              <Check className="h-3 w-3 mr-1" />
              {t`Current`}
            </Badge>
          </div>
        )}

        <CardHeader className="pb-4">
          <h3 className="font-semibold">{displayName}</h3>
          {tagline && (
            <p className="text-sm text-muted-foreground min-h-10">{tagline}</p>
          )}
          <div className="pt-2">
            {plan.basePrice === 0 ? (
              <span className="text-3xl font-bold tracking-tight">{t`Free`}</span>
            ) : (
              <>
                <span className="text-3xl font-bold tracking-tight">
                  €{plan.basePrice}
                </span>
                <span className="text-sm text-muted-foreground">
                  {" "}
                  {t`/month excl. VAT`}
                </span>
              </>
            )}
          </div>
        </CardHeader>

        <CardContent className="flex-1 space-y-4">
          {options?.tierSelector && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {t`Documents per month`}
              </p>
              <ToggleGroup
                type="single"
                variant="outline"
                className="w-full"
                value={selectedTierId}
                onValueChange={(value) => {
                  if (value) setSelectedTierId(value);
                }}
              >
                {professionalTiers.map((tier) => (
                  <ToggleGroupItem
                    key={tier.id}
                    value={tier.id}
                    className="text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    {tier.includedMonthlyDocuments.toLocaleString(language)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}
          <ul className="space-y-2">
            <li className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-primary shrink-0" />
              <span>
                <span className="font-medium">
                  {plan.includedMonthlyDocuments.toLocaleString(language)}
                </span>{" "}
                {t`documents included`}
              </span>
            </li>
            <li className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-primary shrink-0" />
              <span>
                {t`€${plan.documentOveragePrice.toFixed(2)} per extra document`}
              </span>
            </li>
          </ul>
        </CardContent>

        <CardFooter>
          <Button
            className="w-full"
            variant={
              isActiveCurrent ? "secondary" : isPopular ? "default" : "outline"
            }
            onClick={() => handleStartSubscription(plan.id)}
            disabled={isActiveCurrent}
          >
            {isCurrent
              ? currentSubscription?.endDate
                ? t`Resume Subscription`
                : t`Current Plan`
              : t`Select Plan`}
          </Button>
        </CardFooter>
      </Card>
    );
  };

  return (
    <div className="w-full">
      {showHeader && (
        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t`Available Plans`}</h2>
          <p className="text-muted-foreground">
            {currentSubscription
              ? t`Upgrade or change your current plan`
              : t`Choose the perfect plan for your needs`}
          </p>
        </div>
      )}
      <div className="grid gap-4 pt-3 md:grid-cols-3 items-stretch">
        {basePlans.map((plan) => renderPlanCard(plan))}
        {selectedTier && renderPlanCard(selectedTier, { tierSelector: true })}
      </div>
      <p className="mt-4 text-xs text-muted-foreground text-center">
        {t`Need more than ${Math.max(
          ...availablePlans.map((plan) => plan.includedMonthlyDocuments)
        ).toLocaleString(language)} documents per month? Contact us for a custom plan.`}
      </p>
    </div>
  );
}
