import type { Subscription } from "@peppol/data/subscriptions";

export function canUseIntegrations(
  isPlayground: boolean,
  subscription: Pick<Subscription, "planId"> | null
): boolean {
  if (isPlayground) {
    return true;
  }

  if (!subscription) {
    return false;
  }

  const allowedPlanIds = ["starter", "professional", "enterprise"];
  return subscription.planId !== null && allowedPlanIds.includes(subscription.planId);
}

