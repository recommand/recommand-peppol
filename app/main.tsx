import React, { useEffect } from "react";
import {
  CreditCard,
  Building,
  History,
  Webhook,
  Send,
  Tag,
  Database,
  Truck,
  Users,
} from "lucide-react";
import { useMenuItemActions } from "@core/lib/menu-store";
import { useOnboardingActions } from "@core/lib/onboarding-store";
import BillingOnboarding from "@peppol/components/onboarding/billing";
import SubscriptionOnboarding from "@peppol/components/onboarding/subscription";
import CompanyOnboarding from "@peppol/components/onboarding/company";
import AddPlayground from "./add-playground";
import PlaygroundUI from "./playground-ui";
import { useTranslation } from "@core/hooks/use-translation";

export default function Main({ children }: { children: React.ReactNode }) {
  const { registerMenuItem } = useMenuItemActions();
  const { registerOnboardingStep } = useOnboardingActions();
  const { t } = useTranslation();

  useEffect(() => {
    registerMenuItem({
      id: "main.send",
      title: t`Send document`,
      icon: Send,
      href: "/send-document",
    });

    registerMenuItem({
      id: "main.history",
      title: t`Sent and received`,
      icon: History,
      href: "/transmitted-documents",
    });

    registerMenuItem({
      id: "main.companies",
      title: t`Companies`,
      icon: Building,
      href: "/companies",
    });

    registerMenuItem({
      id: "main.labels",
      title: t`Labels`,
      icon: Tag,
      href: "/labels",
    });

    registerMenuItem({
      id: "main.supporting-data",
      title: t`Supporting data`,
      icon: Database,
    });

    registerMenuItem({
      id: "main.supporting-data.suppliers",
      title: t`Suppliers`,
      icon: Truck,
      href: "/suppliers",
    });

    registerMenuItem({
      id: "main.supporting-data.customers",
      title: t`Customers`,
      icon: Users,
      href: "/customers",
    });

    registerMenuItem({
      id: "user.billing.subscription",
      title: t`Subscription`,
      icon: CreditCard,
      href: "/billing/subscription",
    });

    registerMenuItem({
      id: "user.api.webhooks",
      title: t`Webhooks and rules`,
      icon: Webhook,
      href: "/webhooks",
    });

    registerOnboardingStep({
      id: "peppol.subscription",
      scope: "team",
      title: t`Pick a plan`,
      description: t`We offer a variety of plans, pick one that suits your needs.`,
      render: ({ onComplete }) => {
        return <SubscriptionOnboarding onComplete={onComplete} />;
      },
    });

    registerOnboardingStep({
      id: "peppol.billing",
      scope: "team",
      title: t`Create a billing profile`,
      description: t`A billing profile is required to get started.`,
      render: ({ onComplete }) => {
        return <BillingOnboarding onComplete={onComplete} />;
      },
    });

    registerOnboardingStep({
      id: "peppol.company",
      scope: "team",
      title: t`Set up your first company`,
      description: t`Companies are the legal entities you send or receive Peppol documents for.`,
      render: ({ onComplete }) => {
        return <CompanyOnboarding onComplete={onComplete} />;
      },
    });
  }, [registerMenuItem, registerOnboardingStep, t]);

  return (
    <>
      {children}
      <AddPlayground />
      <PlaygroundUI />
    </>
  );
}
